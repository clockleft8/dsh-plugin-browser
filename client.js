// dsh-plugin-browser —— 浏览器半
// 列表 + 详情 + 开关 + 上次异常启动的线索。
// 塞进输入框走的是 conversation.view 自带的 inputActions；拿不到就退回剪贴板。
window.__ModuleLoader__.load({
  id: 'dsh-plugin-browser',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const API = '/plugin-browser/api';

    // 本地中文名表：官方没有统一翻译，插件显示名由各插件自己给 meta.title，
    // 大多数第三方没给，于是列表里全是包名。这里给已装的补一张表，认不出的照旧显示包名。
    const ZH_NAMES = {
      '@linxin666/dsh-client-ui-skin-blue-fantasy': '蓝幻想皮肤',
      '@linxin666/dsh-client-ui-skin-minecraft': '我的世界皮肤',
      '@linxin666/dsh-client-ui-skin-whale-song': '鲸歌皮肤',
      '@smalltailqwq/dsh-client-ui-skin-deep-whale-manager': '深鲸管理皮肤',
      '@smalltailqwq/dsh-client-ui-skin-maid-atelier': '女仆工坊皮肤',
      '@vlln/dsh-navbar': '顶部导航栏',
      '@local/dsh-screenshot': '截图',
      'dsh-plugin-browser': '插件浏览器（本插件）',
      'dsh-window-desk': '窗口台（本插件）',
      'dsh-game-corner': '小游戏角（本插件）',
      'dsh-mnemon': '记忆中枢',
      'dsh-mnemon-source-memory-spaces': '记忆源 · 记忆空间',
      'dsh-mnemon-source-documents': '记忆源 · 文档',
      'dsh-mnemon-source-runtime': '记忆源 · 运行时',
      'dsh-mnemon-source-skills': '记忆源 · 技能',
      'dsh-mnemon-strategy-default-three-tier': '记忆策略 · 默认三层',
      'dsh-mnemon-strategy-scoped': '记忆策略 · 作用域',
      'dsh-mnemon-strategy-light-context': '记忆策略 · 轻上下文',
      'dsh-mnemon-strategy-general': '记忆策略 · 通用',
      'dsh-mnemon-strategy-auto-capture': '记忆策略 · 自动捕获',
      'dsh-agent-clock': '时钟',
      'dsh-agent-memory': '记忆',
      'dsh-agent-mnemon-probe': '记忆探针',
      'dsh-agent-mobile-adapt': '手机适配',
      'dsh-agent-model-statusbar': '本地模型状态卡',
      'dsh-agent-riji': '日记',
      'dsh-agent-soul': '灵魂架构',
      'dsh-agent-splash': '启动画面',
      'dsh-agent-yantai': '砚台',
      'dsh-balance-widget': '余额挂件',
      'dsh-bili-subagent': 'B站子代理',
      'dsh-composer-dynamic-island': '输入框灵动岛',
      'dsh-feiyu-mood': '大肥鱼心情',
      'dsh-fish-memory': '鱼的记忆',
      'dsh-huanqi': '换气',
      'dsh-model-router': '模型路由',
      'dsh-qq-bridge': 'QQ',
      'dsh-routing-suite': '路由套件',
      'dsh-speak-up': '主动搭话',
      'dsh-status-rotator': '状态轮播',
      'dsh-undo-savepoint': '撤销快照',
      'dsh-whale-galgame': '鲸鱼 Galgame',
      'dsh-whale-widget': '鲸鱼挂件',
      'dsh-our-free-model': '免费模型',
      'cordis:include': '加载器根节点（只读）',
    };

    function displayName(item) {
      if (item.title) return item.title;
      const zh = ZH_NAMES[item.moduleName];
      if (zh) return zh;
      // 官方的包名太长，收成「dsh-」后面那段，至少短一点
      return item.moduleName.replace('@deepseek-ai/', '').replace(/^dsh-/, '');
    }

    // 详情窗开的是谁，放在模块级：窗口挂到 shell.overlay 上，
    // 切到别的栏目（对话 / 砚台…）也不会被卸载。它就是页面里的浮层，
    // 出不了 DSH 这个窗口 —— 浏览器页面没有桌面窗口的权限。
    const detailStore = { id: '', subs: new Set() };
    function setDetailId(id) {
      detailStore.id = id || '';
      detailStore.subs.forEach(function (fn) { fn(); });
    }
    function useDetailId() {
      const pair = React.useState(0);
      const bump = pair[1];
      React.useEffect(function () {
        const fn = function () { bump(function (n) { return n + 1; }); };
        detailStore.subs.add(fn);
        return function () { detailStore.subs.delete(fn); };
      }, []);
      return detailStore.id;
    }

    const C = {
      ink: '#e8eef6',
      dim: '#93a4b8',
      line: 'rgba(147,164,184,0.3)',
      panel: 'rgba(21,27,36,0.6)',
      accent: '#6ea8fe',
      warn: '#e0b25c',
    };

    function btn(extra) {
      return Object.assign({
        border: '1px solid ' + C.line, background: 'transparent', color: C.ink,
        borderRadius: 6, padding: '2px 9px', fontSize: 12, cursor: 'pointer',
      }, extra || {});
    }

    async function getJson(url, init) {
      const res = await fetch(url, init);
      const text = await res.text();
      if (!text) {
        throw new Error('宿主那一半没应答（HTTP ' + res.status + '）。多半是插件宿主半没加载：重启一次 DSH 再看。');
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error('宿主回的不是 JSON（HTTP ' + res.status + '）：' + text.slice(0, 120));
      }
      if (!res.ok && data && data.ok === undefined) {
        throw new Error('HTTP ' + res.status + '：' + (data.message || text.slice(0, 120)));
      }
      return data;
    }

    function findFn(source, names) {
      if (!source || typeof source !== 'object') return null;
      for (let i = 0; i < names.length; i++) {
        const fn = source[names[i]];
        if (typeof fn === 'function') return fn;
      }
      return null;
    }

    // 把一段文字送进当前会话的输入框；接不上就复制到剪贴板。
    function pushToComposer(text, actions) {
      const setter = findFn(actions, ['setDraft', 'setText', 'replaceDraft', 'insertText', 'appendText']);
      if (setter) {
        try { setter(text); return '已放进输入框'; } catch (e) { /* 往下退 */ }
      }
      const submit = findFn(actions, ['submit', 'sendNow', 'send', 'enqueue']);
      if (submit) {
        try { submit(text); return '已发出去'; } catch (e) { /* 往下退 */ }
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
          return '输入接口没接上，已复制到剪贴板';
        }
      } catch (e) { /* 忽略 */ }
      return '没接上，也没复制成功，自己手动抄一下吧';
    }

    function isMine(moduleName) {
      return !moduleName.startsWith('@deepseek-ai/');
    }

    function Row(props) {
      const item = props.item;
      const busy = props.busyId === item.id;
      const open = props.openId === item.id;
      const on = item.enabled;
      return h('div', { style: { borderBottom: '1px solid ' + C.line } },
        h('div', {
          onClick: function () { props.onOpen(item.id); },
          style: {
            display: 'grid', gridTemplateColumns: '10px 1fr auto auto',
            gap: 10, alignItems: 'center', padding: '7px 10px', cursor: 'pointer',
          },
        },
          h('span', {
            title: on ? '开着' : '关着',
            style: { width: 7, height: 7, borderRadius: '50%', background: on ? '#5cc98a' : '#7a4b4b', display: 'block' },
          }),
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { color: C.ink, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
              displayName(item)),
            h('div', { style: { color: C.dim, fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
              item.moduleName + (isMine(item.moduleName) ? ' · 自装' : '') + (open ? ' · 详情' : ''))),
          item.canToggle
            ? h('button', {
                disabled: busy || item.self,
                onClick: function (e) { e.stopPropagation(); props.onToggle(item, !on); },
                style: btn({ borderColor: on ? C.line : C.accent, color: on ? C.dim : C.accent, opacity: busy ? 0.5 : 1 }),
              }, busy ? '…' : (on ? '关掉' : '打开'))
            : h('span', { style: { color: C.dim, fontSize: 11 } }, '只读'),
          h('span', { style: { color: C.dim, fontSize: 11, minWidth: 46, textAlign: 'right' } }, item.phase || ''))
      );
    }

    // 详情：一个可拖动的浮窗，自己轮询宿主，状态实时刷新。位置记在本机。
    const DETAIL_POS_KEY = 'dsh-plugin-browser:detail-pos';

    function readDetailPos() {
      try {
        const raw = window.localStorage.getItem(DETAIL_POS_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (typeof v.x === 'number' && typeof v.y === 'number') return v;
      } catch (e) { /* 读不到就用默认 */ }
      return null;
    }

    // 这次会话在做什么：直接读会话事件流（宿主侧已解好多帧 zstd）
    function SessionPeek() {
      const st = React.useState(null);
      const setSt = st[1];
      React.useEffect(function () {
        let alive = true;
        fetch(API + '/session?n=25').then(function (r) { return r.json(); }).then(function (v) {
          if (alive) setSt(v);
        }).catch(function (e) {
          if (alive) setSt({ ok: false, message: String((e && e.message) || e) });
        });
        return function () { alive = false; };
      }, []);
      const v = st[0];
      return h('div', null,
        h('div', { style: { color: C.dim, fontSize: 11, margin: '10px 0 4px' } },
          v && v.ok
            ? ('这次会话：' + v.total + ' 条事件 · 权限 ' + (v.permission || '?') + ' · 沙箱 ' + (v.sandbox || '?'))
            : '这次会话'),
        v && v.ok && v.events && v.events.length
          ? v.events.map(function (ev, i) {
              return h('div', { key: 's' + i, style: { color: C.dim, fontSize: 11, lineHeight: 1.7, fontFamily: 'ui-monospace, monospace' } },
                '[' + ev.seq + '] ' + ev.kind + '  ' + ev.text);
            })
          : h('div', { style: { color: C.dim, fontSize: 11 } }, (v && v.message) || '读着…'));
    }

    function DetailWindow(props) {
      const posState = React.useState(function () { return readDetailPos() || { x: 60, y: 90 }; });
      const pos = posState[0];
      const setPos = posState[1];
      const dragRef = React.useRef(null);
      const dataState = React.useState(null);
      const data = dataState[0];
      const setData = dataState[1];
      const errState = React.useState('');
      const err = errState[0];
      const setErr = errState[1];

      React.useEffect(function () {
        let alive = true;
        const pull = function () {
          getJson(API + '/detail?id=' + encodeURIComponent(props.id))
            .then(function (res) {
              if (!alive) return;
              if (!res.ok) throw new Error(res.message || '读不到详情');
              setData(res);
              setErr('');
            })
            .catch(function (e) { if (alive) setErr(String((e && e.message) || e)); });
        };
        pull();
        const timer = window.setInterval(pull, 2500);
        return function () { alive = false; window.clearInterval(timer); };
      }, [props.id]);

      const onPointerDown = function (event) {
        if (event.button !== 0) return;
        // 点在按钮上别开始拖：否则 pointer capture 会把 click 吃掉，「关」像没反应。
        if (event.target && event.target.closest && event.target.closest('button')) return;
        dragRef.current = { px: event.clientX, py: event.clientY, x: pos.x, y: pos.y };
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch (e) {}
      };
      const onPointerMove = function (event) {
        const start = dragRef.current;
        if (!start) return;
        setPos({ x: start.x + (event.clientX - start.px), y: start.y + (event.clientY - start.py) });
      };
      const onPointerUp = function (event) {
        if (!dragRef.current) return;
        dragRef.current = null;
        try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (e) {}
        try { window.localStorage.setItem(DETAIL_POS_KEY, JSON.stringify(pos)); } catch (e) { /* 存不了就下次回默认 */ }
      };

      const item = data && data.item;
      const events = (data && data.events) || [];

      return h('div', {
        style: {
          position: 'fixed', left: pos.x, top: pos.y, width: 420, maxHeight: '70vh',
          display: 'flex', flexDirection: 'column', pointerEvents: 'auto', zIndex: 50,
          background: 'rgba(18,23,31,0.97)', border: '1px solid ' + C.line, borderRadius: 10,
          boxShadow: '0 14px 40px rgba(0,0,0,0.45)', overflow: 'hidden',
        },
      },
        h('div', {
          onPointerDown: onPointerDown, onPointerMove: onPointerMove, onPointerUp: onPointerUp,
          style: {
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
            borderBottom: '1px solid ' + C.line, cursor: 'grab', userSelect: 'none',
          },
        },
          h('span', { style: { color: C.ink, fontSize: 13, fontWeight: 600 } },
            item ? displayName(item) : '详情'),
          h('span', {
            style: {
              width: 7, height: 7, borderRadius: '50%',
              background: item && item.phase === 'active' ? '#5cc98a' : (item && item.phase === 'failed' ? '#ff7a7a' : C.dim),
            },
          }),
          h('span', { style: { flex: 1 } }),
          h('button', { onClick: props.onClose, style: btn({ padding: '1px 7px' }) }, '关')),

        h('div', { style: { padding: 10, overflowY: 'auto' } },
          err ? h('div', { style: { color: '#ff9a9a', fontSize: 12, marginBottom: 8 } }, err) : null,
          item ? h('div', null,
            h('div', { style: { color: C.ink, fontSize: 12, marginBottom: 6 } },
              '状态：' + (item.enabled ? '已启用' : '已停用') + ' · phase ' + (item.phase || '空')
              + (item.readOnlyReason ? ' · 只读' : '')),
            h('div', { style: { color: C.dim, fontSize: 11, lineHeight: 1.8, fontFamily: 'ui-monospace, monospace' } },
              'entry: ' + item.id, h('br'),
              'package: ' + item.moduleName, h('br'),
              'patch: ' + (item.patchId || '—')),
            h('div', { style: { display: 'flex', gap: 8, margin: '8px 0', flexWrap: 'wrap' } },
              h('button', {
                onClick: function () { props.onCopy(item.moduleName); }, style: btn(),
              }, '复制包名'),
              item.canToggle
                ? h('button', {
                    onClick: function () { props.onToggle(item, !item.enabled); },
                    style: btn({ borderColor: C.accent, color: C.accent }),
                  }, item.enabled ? '关掉它' : '打开它')
                : null,
              h('button', {
                onClick: function () {
                  props.onCopy('插件 ' + item.moduleName + '（entry ' + item.id + '）现在 phase=' + (item.phase || '空')
                    + '、' + (item.enabled ? '启用' : '停用') + '。请帮我查它有没有问题、为什么报错。');
                }, style: btn(),
              }, '塞进输入框')),
            h('div', { style: { color: C.dim, fontSize: 11, margin: '10px 0 4px' } }, '运行事件（本进程内，最多 40 条）'),
            h(SessionPeek, null),
            events.length
              ? events.map(function (ev, i) {
                  const color = ev.kind === 'failed' ? '#ff7a7a' : (ev.kind === 'phase' ? C.accent : C.dim);
                  return h('div', { key: i, style: { color: color, fontSize: 11, lineHeight: 1.8, fontFamily: 'ui-monospace, monospace' } },
                    ev.t.slice(11, 19) + '  ' + ev.text);
                })
              : h('div', { style: { color: C.dim, fontSize: 11 } }, '还没有变化'))
            : h('div', { style: { color: C.dim, fontSize: 12 } }, '读着…')));
    }

    function View(props) {
      const listState = React.useState(null);
      const data = listState[0];
      const setData = listState[1];
      const errState = React.useState('');
      const err = errState[0];
      const setErr = errState[1];
      const loadingState = React.useState(false);
      const loading = loadingState[0];
      const setLoading = loadingState[1];
      const busyState = React.useState('');
      const busyId = busyState[0];
      const setBusyId = busyState[1];
      const openState = React.useState('');
      const openId = openState[0];
      const setOpenId = openState[1];
      const qState = React.useState('');
      const q = qState[0];
      const setQ = qState[1];
      const noteState = React.useState('');
      const note = noteState[0];
      const setNote = noteState[1];

      const actions = props.inputActions;

      const load = React.useCallback(function () {
        setLoading(true);
        getJson(API + '/list')
          .then(function (res) {
            if (!res.ok) throw new Error(res.message || '读不到插件清单');
            setData(res);
            setErr('');
          })
          .catch(function (e) { setErr(String((e && e.message) || e)); })
          .then(function () { setLoading(false); });
      }, []);

      React.useEffect(function () { load(); }, [load]);

      const toggle = function (item, next) {
        setBusyId(item.id);
        setNote('');
        getJson(API + '/toggle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: item.id, enabled: next }),
        })
          .then(function (res) {
            if (!res.ok) {
              setNote((res.message || '没改成') + (res.result && res.result.error ? '：' + res.result.error.code : ''));
              return;
            }
            const r = res.result || {};
            if (r.application === 'restart-required') setNote('已保存，这个要重启 DSH 才完全生效');
            else if (r.application === 'overridden') setNote('保存了，但被更高优先级覆盖，实际没变');
            else setNote(next ? '已打开' : '已关掉');
            load();
          })
          .catch(function (e) { setNote('请求没发出去：' + String((e && e.message) || e)); })
          .then(function () { setBusyId(''); });
      };

      const copy = function (text) {
        setNote(pushToComposer(text, actions));
      };

      const filterState = React.useState('all');
      const filter = filterState[0];
      const setFilter = filterState[1];

      const healthState = React.useState(null);
      const health = healthState[0];
      const setHealth = healthState[1];
      const runHealth = function () {
        setHealth({ loading: true });
        getJson(API + '/health').then(function (r) {
          setHealth({ data: r });
        }).catch(function (e) {
          setHealth({ error: (e && e.message) || String(e) });
        });
      };

      const items = (data && data.items) || [];
      const matched = items.filter(function (it) {
        if (!q) return true;
        const text = (displayName(it) + ' ' + (it.title || '') + ' ' + it.moduleName).toLowerCase();
        return text.indexOf(q.toLowerCase()) >= 0;
      });

      // 官方 = 包名在 @deepseek-ai 下。注意：entryId 全都是 include: 开头，
      // 拿它判断会把所有插件都判成官方（第一版就踩了这个）。
      function officialOf(it) {
        return it.moduleName.indexOf('@deepseek-ai/') === 0;
      }
      // 第三方再按名字里的词分功能组；分不进的就落「其他」，不硬塞。
      function bucketOf(it) {
        const s = ((it.title || '') + ' ' + it.moduleName).toLowerCase();
        if (/skin|theme|皮肤|外观/.test(s)) return '外观 / 皮肤';
        if (/memory|mnemon|soul|recall|记忆|上下文/.test(s)) return '记忆 / 上下文';
        if (/router|routing|model|llm|balance|usage|token|模型|路由|额度/.test(s)) return '模型 / 路由 / 额度';
        if (/tts|speak|voice|audio|speech|subtitle|声音|语音/.test(s)) return '声音 / 语音';
        if (/bili|qq|message|chat|social|消息|社交/.test(s)) return '社交 / 内容源';
        if (/game|galgame|pet|mood|游戏|娱乐/.test(s)) return '游戏 / 娱乐';
        if (/agent|tool|job|schedule|skill|subagent|workflow|工具|任务/.test(s)) return '智能体 / 工具';
        if (/widget|navbar|composer|sidebar|statusbar|island|badge|dock|ui-|界面|组件/.test(s)) return '界面组件';
        return '其他';
      }

      const shown = matched.filter(function (it) {
        if (filter === 'all') return true;
        const off = officialOf(it);
        return filter === 'official' ? off : !off;
      });

      const groupKeys = [];
      const buckets = {};
      shown.forEach(function (it) {
        const key = officialOf(it) ? '官方插件' : '第三方 · ' + bucketOf(it);
        if (!buckets[key]) { buckets[key] = []; groupKeys.push(key); }
        buckets[key].push(it);
      });
      groupKeys.sort(function (a, b) {
        if (a === '官方插件') return -1;
        if (b === '官方插件') return 1;
        return a.localeCompare(b, 'zh');
      });

      const crash = data && data.lastCrash;

      return h('div', { style: { padding: '18px 22px', maxWidth: 760 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' } },
          h('span', { style: { color: C.ink, fontSize: 16, fontWeight: 600 } }, '插件'),
          h('span', { style: { color: C.dim, fontSize: 12 } },
            data ? (data.toggleable + ' 个能开关 · 共 ' + data.total + ' 条运行时条目') : ''),
          h('span', { style: { flex: 1 } }),
          h('button', {
            onClick: runHealth,
            style: btn({ borderColor: health && health.data && health.data.errorCount ? C.warn : C.accent, color: C.accent }),
            title: '一次性检查：包完整性、入口文件、bundle patch、路由前缀冲突',
          }, health && health.loading ? '自检中…' : '自检'),
          h('button', { onClick: load, style: btn() }, loading ? '刷新中…' : '刷新')),

        health && health.error ? h('div', {
          style: { marginTop: 10, color: C.warn, fontSize: 12 },
        }, '自检没跑成：' + health.error) : null,

        health && health.data ? h('div', {
          style: {
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            border: '1px solid ' + (health.data.errorCount ? C.warn : C.line),
            background: C.panel, fontSize: 12, lineHeight: 1.8, color: C.ink,
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontWeight: 600 } },
              '自检结果：' + health.data.checked + ' 个插件，'
              + health.data.errorCount + ' 个错误，' + health.data.warnCount + ' 个提醒'),
            h('span', { style: { flex: 1 } }),
            h('button', { onClick: function () { setHealth(null); }, style: btn({ padding: '0 7px' }) }, '收起')),
          health.data.issues.length === 0
            ? h('div', { style: { color: C.dim, marginTop: 4 } }, '没发现问题。')
            : h('div', { style: { marginTop: 4 } },
              health.data.issues.map(function (it, i) {
                return h('div', {
                  key: 'h' + i,
                  style: { marginTop: 3, color: it.level === 'error' ? C.warn : C.dim },
                }, (it.level === 'error' ? '✕ ' : '! ') + it.plugin + ' · ' + it.message);
              }))
        ) : null,

        crash ? h('div', {
          style: {
            marginTop: 10, padding: '9px 12px', borderRadius: 8,
            border: '1px solid ' + C.warn, color: C.warn, fontSize: 12, lineHeight: 1.8,
          },
        },
          '上一次启动没有正常结束。上次开始于：' + (crash.startedAt || '不知道') + '（pid ' + (crash.pid || '?') + '）。',
          h('div', { style: { display: 'flex', gap: 8, marginTop: 6 } },
            h('button', {
              onClick: function () {
                copy('上次 DSH 启动异常。上一次启动时间：' + (crash.startedAt || '未知')
                  + '，pid ' + (crash.pid || '?')
                  + '。现在能正常进界面了。请帮我排查上次是哪个插件导致的，以及该关掉谁。');
              }, style: btn({ borderColor: C.warn, color: C.warn }),
            }, '把这段塞进输入框'),
            h('button', {
              onClick: function () {
                getJson(API + '/clearcrash', { method: 'POST' })
                  .then(function () { setNote('已忽略这次'); load(); });
              }, style: btn(),
            }, '忽略')))
          : null,

        h('div', { style: { display: 'flex', gap: 8, margin: '10px 0', flexWrap: 'wrap' } },
          h('button', { onClick: function () { setFilter('all'); }, style: btn({ borderColor: filter === 'all' ? C.accent : C.line, color: filter === 'all' ? C.accent : C.dim }) }, '全部'),
          h('button', { onClick: function () { setFilter('official'); }, style: btn({ borderColor: filter === 'official' ? C.accent : C.line, color: filter === 'official' ? C.accent : C.dim }) }, '官方'),
          h('button', { onClick: function () { setFilter('third'); }, style: btn({ borderColor: filter === 'third' ? C.accent : C.line, color: filter === 'third' ? C.accent : C.dim }) }, '第三方'),
          h('input', {
            value: q,
            onChange: function (e) { setQ(e.target.value); },
            placeholder: '搜名字或包名',
            style: {
              flex: 1, minWidth: 160, background: 'transparent', color: C.ink, fontSize: 13,
              border: '1px solid ' + C.line, borderRadius: 6, padding: '5px 9px',
            },
          })),

        err ? h('div', { style: { color: '#ff9a9a', fontSize: 12, marginBottom: 8 } }, err) : null,
        note ? h('div', { style: { color: C.accent, fontSize: 12, marginBottom: 8 } }, note) : null,

        groupKeys.length
          ? groupKeys.map(function (key) {
              const list = buckets[key];
              return h('div', { key: key, style: { marginBottom: 14 } },
                h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, margin: '0 0 6px 2px' } },
                  h('span', { style: { color: C.ink, fontSize: 13, fontWeight: 600 } }, key),
                  h('span', { style: { color: C.dim, fontSize: 11 } }, list.length + ' 个')),
                h('div', { style: { border: '1px solid ' + C.line, borderRadius: 8, background: C.panel, overflow: 'hidden' } },
                  list.map(function (it) {
                    return h(Row, {
                      key: it.id, item: it, busyId, openId, onToggle: toggle,
                      onOpen: function (id) { setOpenId(openId === id ? '' : id); setDetailId(openId === id ? '' : id); },
                      onCopy: copy,
                    });
                  })));
            })
          : h('div', { style: { padding: 14, color: C.dim, fontSize: 12 } }, loading ? '读着…' : '没有匹配的插件'),

        openId ? null : null,

        h('div', { style: { color: C.dim, fontSize: 12, lineHeight: 1.7, marginTop: 12 } },
          '点一行看详情；开关改的是这个 profile 的配置，和设置里点的一样。有些是核心模块只能看；自己这个插件不允许在这里关。',
          h('br'),
          '异常启动的记录存在本机：' + (data && data.markerPath ? data.markerPath : '（读不到路径）') + '。'));
    }

    // 浮在整页之上，切栏目也不消失；代价是这里拿不到输入框接口，
    // 「塞进输入框」会退回复制到剪贴板（函数里本来就这么兜底）。
    function DetailOverlay() {
      const id = useDetailId();
      if (!id) return null;
      const toggle = function (item, next) {
        getJson(API + '/toggle', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: item.id, enabled: next }),
        }).catch(function () { /* 详情窗自己轮询，失败会显示在状态里 */ });
      };
      return h(DetailWindow, {
        key: id, id: id,
        onClose: function () { setDetailId(''); },
        onCopy: function (text) { pushToComposer(text, null); },
        onToggle: toggle,
      });
    }

    function apply(ctx) {
      ctx.slots.inject('conversation.view', function () {
        ctx.slots.register(
          { name: 'conversation.view', id: 'plugin-browser', order: 9, label: '插件' },
          View);
      });
      ctx.slots.inject('shell.overlay', function () {
        ctx.slots.register(
          { name: 'shell.overlay', id: 'plugin-browser-detail', order: 60, label: '插件详情' },
          DetailOverlay);
      });
    }

    return { inject: ['slots'], apply: apply };
  },
});
