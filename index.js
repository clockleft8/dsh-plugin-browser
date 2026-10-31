// dsh-plugin-browser —— 宿主半
// 1. 把插件管理员的真实状态端给页面（列清单、切开关、单插件详情）；
// 2. 记「这个插件发生过什么」的事件流（首次见到 / 相位变化 / 开关 / 失败），
//    页面轮询详情就能看到实时状态，不用刷新整页；
// 3. 开机标记：下次启动发现上次没正常退出，把线索交给页面。
// 不读凭据，不猜别人的文件结构。

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_DIR = join(DSH_HOME, 'plugin-browser')
const MARKER = join(STATE_DIR, 'boot.json')
const EVENTS_FILE = join(STATE_DIR, 'events.jsonl')
const KEEP_DAYS = 7

// 每个 entry 最近一段事件。内存里跑，同时追加到 events.jsonl；
// 启动时把最近 KEEP_DAYS 天的读回来，所以重启也翻得到旧账。
const EVENTS = new Map()
const LAST = new Map()
const MAX_EVENTS = 40

function note(id, kind, text) {
  const ev = { id, t: new Date().toISOString(), kind, text: text || '' }
  const list = EVENTS.get(id) || []
  list.push(ev)
  if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS)
  EVENTS.set(id, list)
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(EVENTS_FILE, JSON.stringify(ev) + '\n', 'utf8')
  } catch (e) { /* 写不了就只在内存里 */ }
}

function loadEvents() {
  try {
    if (!existsSync(EVENTS_FILE)) return
    const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000
    const lines = readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean)
    const kept = []
    lines.forEach((line) => {
      let ev
      try { ev = JSON.parse(line) } catch (e) { return }
      if (!ev || !ev.id || !ev.t) return
      const at = Date.parse(ev.t)
      if (!Number.isFinite(at) || at < cutoff) return
      kept.push(ev)
      const list = EVENTS.get(ev.id) || []
      list.push(ev)
      if (list.length > MAX_EVENTS) list.splice(0, list.length - MAX_EVENTS)
      EVENTS.set(ev.id, list)
    })
    // 顺手裁掉过期行，别让文件一直长
    writeFileSync(EVENTS_FILE, kept.map((ev) => JSON.stringify(ev)).join('\n') + (kept.length ? '\n' : ''), 'utf8')
  } catch (e) { /* 读不了就当没有旧账 */ }
}

function readMarker() {
  try {
    if (!existsSync(MARKER)) return null
    return JSON.parse(readFileSync(MARKER, 'utf8'))
  } catch (e) {
    return null
  }
}

function writeMarker(data) {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(MARKER, JSON.stringify(data, null, 2), 'utf8')
    return true
  } catch (e) {
    return false
  }
}

function json(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 64 * 1024) { reject(new Error('请求太大')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { reject(new Error('请求不是合法 JSON')) }
    })
    req.on('error', reject)
  })
}

function titleOf(entry) {
  const meta = entry.meta || {}
  const title = meta.title
  if (typeof title === 'string') return title
  if (title && typeof title === 'object') return title.zh || title['zh-CN'] || title.en || ''
  return ''
}

function viewOf(entry) {
  return {
    id: entry.entryId,
    moduleName: entry.moduleName,
    patchId: entry.patchId || null,
    title: titleOf(entry),
    enabled: entry.enabled,
    phase: entry.fiberPhase || null,
    canToggle: !entry.readOnlyReason,
    readOnlyReason: entry.readOnlyReason || null,
    self: entry.moduleName === 'dsh-plugin-browser',
  }
}

// 跟上一轮看到的状态比，把变化写成事件。
function observe(items) {
  items.forEach((it) => {
    const prev = LAST.get(it.id)
    if (!prev) {
      note(it.id, 'seen', '本次运行里第一次看到：' + (it.phase || '无相位') + (it.enabled ? '、已启用' : '、已停用'))
    } else {
      if (prev.phase !== it.phase) {
        note(it.id, it.phase === 'failed' ? 'failed' : 'phase', '相位 ' + (prev.phase || '空') + ' → ' + (it.phase || '空'))
      }
      if (prev.enabled !== it.enabled) {
        note(it.id, 'toggle', it.enabled ? '启用' : '停用')
      }
    }
    LAST.set(it.id, { phase: it.phase, enabled: it.enabled })
  })
}

// 不写死 inject：宿主服务可能比本插件晚就绪，交给重试去等。
// 当前 DSH 版本：从 app.asar 里的 dsh/package.json 读，读不到就返回 null（不猜）
let CACHED_DSH_VERSION
function dshVersion() {
  if (CACHED_DSH_VERSION !== undefined) return CACHED_DSH_VERSION
  CACHED_DSH_VERSION = null
  const cands = []
  if (process.resourcesPath) cands.push(join(process.resourcesPath, 'app.asar', 'dsh', 'package.json'))
  cands.push(join(DSH_HOME, 'version.json'))
  for (const p of cands) {
    try {
      if (!existsSync(p)) continue
      const raw = JSON.parse(readFileSync(p, 'utf8'))
      if (raw && typeof raw.version === 'string') { CACHED_DSH_VERSION = raw.version; break }
    } catch (e) { /* 换下一个 */ }
  }
  return CACHED_DSH_VERSION
}
function verNum(v) {
  if (typeof v !== 'string') return null
  const m = v.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return null
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] || 0)
}

// 一次性自检：包完整性 + 路由前缀冲突。只读，不改任何东西。
function checkHealth(pm) {
  const issues = []
  const add = (level, plugin, kind, message) => issues.push({ level, plugin, kind, message })
  const roots = []
  const deps = new Set()
  try {
    const profs = join(DSH_HOME, 'profiles')
    if (existsSync(profs)) {
      for (const name of readdirSync(profs)) {
        const profDir = join(profs, name)
        roots.push(join(profDir, 'node_modules'))
        // 只有写进 profile 依赖里的包才叫「用户装的」；官方内置包不在依赖表里
        try {
          const pkg = JSON.parse(readFileSync(join(profDir, 'package.json'), 'utf8'))
          for (const k of Object.keys(pkg.dependencies || {})) deps.add(k)
        } catch (e) { /* 读不到就不算用户包 */ }
      }
    }
  } catch (e) { /* 读不到就用空列表 */ }

  return Promise.resolve(pm.listPlugins()).then((list) => {
    const prefixes = new Map()
    for (const raw of list) {
      const item = viewOf(raw)
      const dir = roots.map((r) => join(r, item.moduleName)).find((p) => existsSync(p))
      if (!dir) {
        // 只对「用户自己装进 profile 依赖」的包报缺失；官方内置包不参与
        const userInstalled = deps.has(item.moduleName)
        if (item.enabled && userInstalled) {
          add('warn', item.moduleName, 'missing', 'profile 依赖里有它，但 node_modules 下没有实体目录：junction 断了或包被删了')
        }
        continue
      }
      let pkg = null
      try {
        pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      } catch (e) {
        add('error', item.moduleName, 'package-json', 'package.json 读不了或不是合法 JSON：' + e.message)
        continue
      }
      // 入口解析：exports 优先，其次 main / dsh 字段，最后才猜约定文件名
      const pickExport = (exp) => {
        if (typeof exp === 'string') return exp
        if (exp && typeof exp === 'object') {
          for (const k of ['import', 'default', 'require', 'web', 'browser']) {
            if (typeof exp[k] === 'string') return exp[k]
          }
        }
        return null
      }
      const exportsMap = (pkg.exports && typeof pkg.exports === 'object') ? pkg.exports : {}
      const resolveEntry = (sub, extra) => {
        const cands = []
        const fromExp = pickExport(exportsMap[sub])
        if (fromExp) cands.push(fromExp)
        ;(extra || []).forEach((p) => { if (typeof p === 'string' && p) cands.push(p) })
        return cands
      }
      const firstExisting = (cands) => {
        for (const p of cands) if (existsSync(join(dir, p))) return p
        return null
      }
      // 已经在跑的插件，文件对不上不可能是致命的；没跑起来的才算错误
      const sev = item.phase === 'active' ? 'warn' : 'error'

      // 版本不适配 = 真可能跑不起来，按错误报（红色）
      const dsh = pkg.dsh || {}
      {
        const wantRange = (pkg.engines && pkg.engines.dsh) || (pkg.peerDependencies && pkg.peerDependencies.dsh)
        const cur = dshVersion()
        if (wantRange && cur) {
          const want = verNum(wantRange)
          const have = verNum(cur)
          if (want !== null && have !== null && have < want) {
            add('error', item.moduleName, 'dsh-version', '要求 DSH ' + wantRange + '，当前 ' + cur + '：版本不适配，可能起不来')
          }
        }
      }
      const hostCands = resolveEntry('.', [dsh.entry, pkg.main])
      const hostEntry = firstExisting(hostCands.length ? hostCands : ['index.js'])
      if (!hostEntry && hostCands.length) {
        add(sev, item.moduleName, 'entry', '声明的入口与实际文件对不上（找过 ' + hostCands.join(' / ') + '）')
      }
      if (dsh.bundle) {
        const patch = (dsh.bundle && dsh.bundle.patch) || 'cordis.patch.yml'
        if (!existsSync(join(dir, patch))) add(sev, item.moduleName, 'bundle-patch', 'bundle 声明的 patch 不存在：' + patch)
      }
      if (dsh.client) {
        const clientCands = resolveEntry('./client', [(dsh.client && dsh.client.entry), 'client.js'])
        if (!firstExisting(clientCands) && clientCands.length) {
          add(sev, item.moduleName, 'client', 'client 半的入口找不到（找过 ' + clientCands.join(' / ') + '）')
        }
      }
      // 完整性都对得上，却根本没跑起来：这就是「版本不适配或加载报错」，按错误报
      const hasErrorAlready = issues.some((x) => x.plugin === item.moduleName && x.level === 'error')
      if (item.enabled && item.phase !== 'active' && !hasErrorAlready) {
        add('error', item.moduleName, 'not-running', '文件完整但没跑起来（phase=' + (item.phase || '空') + '）：多半是版本不适配或加载时报错')
      }
      try {
        const src = readFileSync(join(dir, hostEntry || 'index.js'), 'utf8')
        const re = /path:\s*'(\/[^']*)'/g
        let m
        while ((m = re.exec(src))) {
          const p = m[1]
          if (!prefixes.has(p)) prefixes.set(p, [])
          prefixes.get(p).push(item.moduleName)
        }
      } catch (e) { /* 读不了就跳过冲突扫描 */ }
    }
    for (const entry of prefixes) {
      const p = entry[0]
      const uniq = Array.from(new Set(entry[1]))
      if (uniq.length > 1) {
        add('warn', uniq.join(' / '), 'route-conflict', '多个插件注册了同一个路由前缀 ' + p)
      }
    }
    return {
      ok: true,
      at: new Date().toISOString(),
      checked: list.length,
      issues,
      errorCount: issues.filter((x) => x.level === 'error').length,
      warnCount: issues.filter((x) => x.level === 'warn').length,
    }
  })
}

let booted = false

// 会话流：找最新的 session.jsonl.zstd，解压后取尾部若干条，压成「谁在什么时候做了什么」
function findNewestSession(dir, depth) {
  let best = null
  if (depth > 3 || !existsSync(dir)) return null
  let names = []
  try { names = readdirSync(dir, { withFileTypes: true }) } catch (e) { return null }
  for (const ent of names) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      const sub = findNewestSession(full, depth + 1)
      if (sub && (!best || sub.mtime > best.mtime)) best = sub
    } else if (ent.name.endsWith('.jsonl.zstd') || ent.name === 'session.jsonl.zstd') {
      try {
        const st = statSync(full)
        if (!best || st.mtimeMs > best.mtime) best = { path: full, mtime: st.mtimeMs }
      } catch (e) { /* 单个文件读不到就跳过 */ }
    }
  }
  return best
}

// 会话文件是「多帧 zstd」拼接：一帧一行事件。逐帧解，别指望一次解完
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function decodeFrames(buf) {
  let idx = [], i = 0
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) { idx.push(i); i += 4 }
  const parts = []
  for (const off of idx) {
    try { parts.push(zstdDecompressSync(buf.subarray(off)).toString('utf8')) } catch (e) { /* 坏帧跳过 */ }
  }
  return parts.join('')
}

function briefOf(ev) {
  const d = ev.data || {}
  const t = ev.type || '?'
  if (t === 'permission/preset') return '权限预设：' + (d.preset || '?')
  if (t === 'sandbox/mode') return '沙箱模式：' + (d.mode || '?')
  if (t.indexOf('tool') === 0) return '工具 ' + (d.name || d.tool || t) + (d.args ? ' ' + JSON.stringify(d.args).slice(0, 80) : '')
  if (t === 'message' || t.indexOf('assistant') === 0) {
    const c = d.text || d.content || ev.text
    return typeof c === 'string' ? c.slice(0, 120) : t
  }
  if (t.indexOf('user') === 0) {
    const c = d.text || d.content
    return typeof c === 'string' ? c.slice(0, 120) : '用户输入'
  }
  return t
}

function readSessionTail(limit) {
  const found = findNewestSession(join(DSH_HOME, 'sessions'), 0)
  if (!found) return { ok: false, message: '还没找到会话文件' }
  let text = ''
  try { text = decodeFrames(readFileSync(found.path)) } catch (e) {
    return { ok: false, message: '解压失败：' + e.message }
  }
  const lines = text.split('\n').filter((l) => l.trim())
  const parsed = []
  for (const line of lines) {
    try { parsed.push(JSON.parse(line)) } catch (e) { /* 半行跳过 */ }
  }
  // 最新的权限/沙箱状态单独拎出来，方便一眼看到
  let perm = null, sandbox = null
  for (const ev of parsed) {
    if (ev.type === 'permission/preset') perm = ev.data && ev.data.preset
    if (ev.type === 'sandbox/mode') sandbox = ev.data && ev.data.mode
  }
  const events = parsed.slice(-limit).map((ev) => ({
    seq: ev.seq, at: ev.time || null, kind: ev.type || '?', text: briefOf(ev),
  })).reverse()
  return { ok: true, file: found.path, total: parsed.length, permission: perm, sandbox: sandbox, events: events }
}

export function apply(ctx) {
  const pm = ctx.get('pluginManager')
  const webServer = ctx.get('webServer')
  if (!pm || !webServer) {
    ctx.effect(() => {
      const t = setTimeout(() => apply(ctx), 800)
      return () => clearTimeout(t)
    })
    return
  }

  const previous = booted ? null : readMarker()
  const startedAt = new Date().toISOString()
  const lastCrash = previous && previous.clean === false
    ? { startedAt: previous.startedAt || null, pid: previous.pid || null, note: previous.note || '' }
    : null

  if (!booted) {
    booted = true
    loadEvents()
    writeMarker({ startedAt, pid: process.pid, clean: false, note: '运行中' })
    ctx.effect(() => () => {
      writeMarker({ startedAt, pid: process.pid, clean: true, note: '正常退出于 ' + new Date().toISOString() })
    })
  }

  const route = webServer.register({
    kind: 'prefix',
    path: '/plugin-browser',
    handler: async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1')
      const path = url.pathname.replace(/^\/plugin-browser/, '') || '/'
      // 被调用日志：谁在什么时候点了哪个接口（detail/list 自己是轮询，记了没意义）
      if (path !== '/api/detail' && path !== '/api/list') {
        const hits = EVENTS.get('plugin-browser') || []
        hits.push({ at: Date.now(), text: '调用 ' + req.method + ' ' + path })
        if (hits.length > MAX_EVENTS) hits.splice(0, hits.length - MAX_EVENTS)
        EVENTS.set('plugin-browser', hits)
      }
      try {
        if (path === '/api/list' && req.method === 'GET') {
          const items = (await pm.listPlugins()).map(viewOf)
          observe(items)
          const sorted = items.slice().sort((a, b) => {
            if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
            return (a.title || a.moduleName).localeCompare(b.title || b.moduleName, 'zh')
          })
          return json(res, 200, {
            ok: true,
            builtAt: new Date().toISOString(),
            total: items.length,
            toggleable: items.filter((x) => x.canToggle).length,
            items: sorted,
            lastCrash,
            markerPath: MARKER,
          })
        }

        if (path === '/api/detail' && req.method === 'GET') {
          const id = String(url.searchParams.get('id') || '')
          if (!id) return json(res, 400, { ok: false, message: '缺插件 id' })
          const items = (await pm.listPlugins()).map(viewOf)
          observe(items)
          const item = items.find((x) => x.id === id)
          if (!item) return json(res, 404, { ok: false, message: '没有这个插件：' + id })
          return json(res, 200, {
            ok: true,
            at: new Date().toISOString(),
            item,
            events: (EVENTS.get(id) || []).slice().reverse(),
          })
        }

        if (path === '/api/session' && req.method === 'GET') {
          const n = Number(url.searchParams.get('n')) || 40
          return json(res, 200, readSessionTail(Math.min(Math.max(n, 10), 200)))
        }

        if (path === '/api/health' && req.method === 'GET') {
          const report = await checkHealth(pm)
          return json(res, 200, report)
        }

        if (path === '/api/toggle' && req.method === 'POST') {
          const body = await readBody(req)
          const id = String(body.id || '')
          const enabled = Boolean(body.enabled)
          if (!id) return json(res, 400, { ok: false, message: '缺插件 id' })
          const target = (await pm.listPlugins()).find((x) => x.entryId === id)
          if (!target) return json(res, 404, { ok: false, message: '没有这个插件：' + id })
          if (target.moduleName === 'dsh-plugin-browser') {
            return json(res, 200, { ok: false, message: '不能在这里关掉自己，会连页面一起没了' })
          }
          note(id, 'toggle', '请求' + (enabled ? '启用' : '停用'))
          const result = await pm.setPluginEnabled(id, enabled)
          return json(res, 200, {
            ok: !result.error,
            result: {
              changed: result.changed,
              application: result.application,
              restartReason: result.restartReason || null,
              error: result.error || null,
              warnings: result.warnings || [],
            },
          })
        }

        if (path === '/api/clearcrash' && req.method === 'POST') {
          writeMarker({ startedAt, pid: process.pid, clean: false, note: '已忽略上次异常' })
          return json(res, 200, { ok: true })
        }

        return json(res, 404, { ok: false, message: '没有这个接口' })
      } catch (e) {
        return json(res, 500, { ok: false, message: String((e && e.message) || e) })
      }
    },
  })

  ctx.effect(() => () => {
    if (route && typeof route.dispose === 'function') route.dispose()
  })
}
