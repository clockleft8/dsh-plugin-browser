# DSH 起不来时的现场采集器（不依赖 DSH 运行）
# 用法：右键「一键诊断.bat」以管理员身份运行，或在 PowerShell 里：
#   powershell -ExecutionPolicy Bypass -File diagnose.ps1
# 产物：桌面\dsh-diagnostics\report.txt 与 report.zip，直接把这个 zip 交给 AI 就能查。

param(
    [string]$OutDir = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'dsh-diagnostics')
)

$ErrorActionPreference = 'Continue'
$lines = New-Object System.Collections.Generic.List[string]
function Say($s) { $lines.Add($s) ; Write-Host $s }

Say "=== DSH 诊断报告 ==="
Say ("采集时间：" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ("用户：" + $env:USERNAME + "   计算机：" + $env:COMPUTERNAME)
Say ""

# 1. DSH 安装位置与版本
Say "--- [1] DSH 本体 ---"
$exeCandidates = @(
    "C:\Users\$env:USERNAME\Desktop\1704\大肥鱼\DeepSeek Harness.exe",
    "$env:LOCALAPPDATA\Programs\DeepSeek Harness\DeepSeek Harness.exe",
    "$env:ProgramFiles\DeepSeek Harness\DeepSeek Harness.exe"
)
$exe = $exeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($exe) {
    $fi = Get-Item $exe
    Say ("找到：" + $fi.FullName)
    Say ("大小：" + [math]::Round($fi.Length / 1MB, 1) + " MB    修改时间：" + $fi.LastWriteTime)
    try { Say ("文件版本：" + $fi.VersionInfo.FileVersion + "  产品版本：" + $fi.VersionInfo.ProductVersion) } catch { Say "版本信息读不到" }
} else {
    Say "没在常见位置找到 DSH 主程序（可能装在别处，或已被删除/移动）"
    $exeCandidates | ForEach-Object { Say ("  查过：" + $_) }
}
Say ""

# 2. 数据目录
Say "--- [2] 数据目录 ---"
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
Say ("DSH_HOME：" + $dshHome + "   存在：" + (Test-Path $dshHome))
$profilesDir = Join-Path $dshHome 'profiles'
if (Test-Path $profilesDir) {
    $profiles = Get-ChildItem $profilesDir -Directory
    Say ("profile 数量：" + $profiles.Count + "  ->  " + (($profiles | ForEach-Object { $_.Name }) -join ', '))
    foreach ($p in $profiles) {
        $pkgPath = Join-Path $p.FullName 'package.json'
        Say ""
        Say ("  [profile] " + $p.Name)
        if (-not (Test-Path $pkgPath)) { Say "    package.json 不存在 —— 这是致命的，DSH 无法加载该 profile"; continue }
        $bytes = [System.IO.File]::ReadAllBytes($pkgPath)
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            Say "    !! package.json 带 UTF-8 BOM —— 常见启动失败原因（JSON 解析器会报错）"
        }
        $raw = [System.Text.Encoding]::UTF8.GetString($bytes)
        try {
            $pkg = $raw | ConvertFrom-Json
            Say ("    JSON 解析：OK    依赖数：" + ($pkg.dependencies.PSObject.Properties.Name).Count)
        } catch {
            Say ("    !! JSON 解析失败：" + $_.Exception.Message)
            Say "    （已把原文前 800 字附到报告末尾，供修复）"
            Say "----- package.json 原文开头 -----"
            Say $raw.Substring(0, [Math]::Min(800, $raw.Length))
            Say "----- 原文结束 -----"
            continue
        }
        $nm = Join-Path $p.FullName 'node_modules'
        Say ("    node_modules 存在：" + (Test-Path $nm))
        $names = @()
        if ($pkg.dependencies) { $names = $pkg.dependencies.PSObject.Properties.Name }
        $depList = if ($pkg.dependencies) { $pkg.dependencies } else { @{} }
        $bad = 0
        foreach ($n in $names) {
            $spec = [string]$depList.$n
            $dir = Join-Path $nm $n
            $ok = Test-Path $dir
            if (-not $ok) { $bad++; Say ("    !! 缺目录：" + $n + "   （依赖声明：" + $spec + "）") }
        }
        Say ("    缺失的依赖目录：" + $bad + " 个")
        $enableList = @()
        foreach ($key in @('dsh.profile.plugins', 'dsh.profile.bundles')) {
            $v = $pkg
            foreach ($seg in $key.Split('.')) { if ($v) { $v = $v.$seg } }
            if ($v) { $enableList += @($v) }
        }
        if ($enableList.Count -gt 0) {
            $missing = @($enableList | Where-Object { $n = if ($_ -is [string]) { $_ } else { $_.name }; -not (Test-Path (Join-Path $nm $n)) })
            Say ("    启用清单条目：" + $enableList.Count + "   其中目录缺失：" + $missing.Count)
            $missing | Select-Object -First 10 | ForEach-Object { $n = if ($_ -is [string]) { $_ } else { $_.name }; Say ("    !! 启用但没装：" + $n) }
        }
    }
} else {
    Say "profiles 目录不存在 —— DSH 首次启动会重建，但如果之前有数据，说明被删了或路径变了"
}
Say ""

# 3. 上次是否正常退出
Say "--- [3] 上次运行标记 ---"
$marker = Join-Path $dshHome 'plugin-browser\boot.json'
if (Test-Path $marker) {
    try {
        $b = [System.IO.File]::ReadAllText($marker, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
        Say ("上次启动：" + $b.startedAt + "   pid：" + $b.pid + "   正常退出：" + (-not ($b.clean -eq $false)) + "   备注：" + $b.note)
        if ($b.clean -eq $false) {
            $alive = $false
            if ($b.pid) { try { $null = Get-Process -Id $b.pid -ErrorAction Stop; $alive = $true } catch { $alive = $false } }
            if ($alive) {
                Say ("该进程（pid=" + $b.pid + "）此刻仍在运行 —— 标记未清只是因为还没退出，不是崩溃")
            } else {
                Say "!! 上次没有正常退出，且那个进程已经不存在 —— 崩溃或被强杀，这是「打不开」的直接证据"
            }
        }
    } catch { Say "标记文件存在但读不了：$($_.Exception.Message)" }
} else {
    Say "没有运行标记（插件管理器没跑过，或这是首次启动）"
}
$eventsFile = Join-Path $dshHome 'plugin-browser\events.jsonl'
if (Test-Path $eventsFile) {
    Say ("事件文件：" + $eventsFile + "  " + [math]::Round((Get-Item $eventsFile).Length / 1KB, 1) + " KB")
    Say "最近 15 条事件："
    Get-Content $eventsFile -Tail 15 -Encoding UTF8 | ForEach-Object { Say ("  " + $_) }
} else { Say "没有事件文件" }
Say ""

# 4. 会话文件
Say "--- [4] 会话数据 ---"
$sessDir = Join-Path $dshHome 'sessions'
if (Test-Path $sessDir) {
    $newest = Get-ChildItem $sessDir -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3
    foreach ($f in $newest) {
        Say ("  " + $f.LastWriteTime + "  " + [math]::Round($f.Length / 1KB, 0) + " KB  " + $f.FullName.Replace($dshHome, '~\.dsh'))
    }
} else { Say "会话目录不存在" }
Say ""

# 5. 端口占用（常见「打不开」其实是被旧进程占着）
Say "--- [5] 可能残留的进程 / 端口 ---"
$procs = Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue
if ($procs) { $procs | ForEach-Object { Say ("  运行中：pid=" + $_.Id + "  内存=" + [math]::Round($_.WorkingSet64 / 1MB, 0) + "MB  启动=" + $_.StartTime) } }
else { Say "  当前没有 DeepSeek Harness 进程在跑" }
Say ""

Say "=== 报告结束 ==="
Say "把这个 report.zip 交给 AI，说明「DSH 打不开」，它就能据此判断。"

# 落盘
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$txt = Join-Path $OutDir 'report.txt'
[System.IO.File]::WriteAllLines($txt, $lines, (New-Object System.Text.UTF8Encoding($false)))
$zip = Join-Path $OutDir 'report.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $txt -DestinationPath $zip -Force
Write-Host ""
Write-Host ("报告已生成：" + $txt)
Write-Host ("压缩包：" + $zip)
