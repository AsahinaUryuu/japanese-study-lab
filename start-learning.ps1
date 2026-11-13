param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

function Get-CommandTokens([string]$CommandLine) {
    if (-not $CommandLine) { return @() }
    return @([regex]::Matches($CommandLine, '"[^"]*"|\S+') | ForEach-Object { $_.Value.Trim('"') })
}

function Test-SamePath([string]$First, [string]$Second) {
    if (-not $First -or -not $Second) { return $false }
    # A process's working directory is not available here. Never resolve its
    # relative argument against our own cwd and accidentally claim another app.
    $absolute = '^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])'
    if ($First -notmatch $absolute -or $Second -notmatch $absolute) { return $false }
    try { return [IO.Path]::GetFullPath($First).TrimEnd('\').Equals([IO.Path]::GetFullPath($Second).TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase) } catch { return $false }
}

function Test-AppServer($Process, [string]$ServerPath) {
    if ($Process.Name -ne 'node.exe') { return $false }
    $tokens = @(Get-CommandTokens $Process.CommandLine)
    return $tokens.Count -ge 2 -and (Test-SamePath $tokens[1] $ServerPath)
}

function Test-AppLauncher($Process, [string]$LauncherPath) {
    if ($Process.Name -notin @('powershell.exe','pwsh.exe')) { return $false }
    $tokens = @(Get-CommandTokens $Process.CommandLine)
    for ($i = 1; $i -lt $tokens.Count - 1; $i++) {
        if ($tokens[$i] -ieq '-File') { return Test-SamePath $tokens[$i + 1] $LauncherPath }
    }
    return $false
}

function Test-AppBatchWindow($Process, [string]$BatchPath) {
    if ($Process.Name -ne 'cmd.exe' -or -not $Process.CommandLine) { return $false }
    # Only a dedicated cmd /c invocation of this exact BAT is ours. An open
    # interactive shell (/k), wrappers and extra shell commands are left alone.
    $match = [regex]::Match($Process.CommandLine, '(?i)(?:^|\s)/c\s+(.+)$')
    if (-not $match.Success) { return $false }
    $command = $match.Groups[1].Value.Trim().Trim('"').Trim()
    if ($command -match '[&|<>]') { return $false }
    return Test-SamePath $command $BatchPath
}

function Stop-VerifiedProcess($Snapshot) {
    if (-not $Snapshot -or [int]$Snapshot.ProcessId -eq $PID) { return }
    $live = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$Snapshot.ProcessId) -ErrorAction SilentlyContinue
    if (-not $live) { return }
    if ($live.Name -ne $Snapshot.Name -or $live.CreationDate -ne $Snapshot.CreationDate -or $live.CommandLine -ne $Snapshot.CommandLine) {
        throw '进程身份发生变化，已停止自动关闭操作。请重试启动。'
    }
    Stop-Process -Id ([int]$live.ProcessId) -Force -ErrorAction SilentlyContinue
}

function Test-AppReady([int]$Port, [int]$ServerId) {
    $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not ($listener | Where-Object { $_.OwningProcess -eq $ServerId })) { return $false }
    try {
        $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/api/health")
        $request.Proxy = $null; $request.Timeout = 800
        $response = $request.GetResponse()
        try { $reader = New-Object IO.StreamReader($response.GetResponseStream()); $health = $reader.ReadToEnd() | ConvertFrom-Json; $reader.Dispose() }
        finally { $response.Dispose() }
        return $health.ok -eq $true -and $health.service -eq 'japanese-academy'
    } catch { return $false }
}

function Start-LearningApp([switch]$SkipBrowser) {
    $appRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
    $serverPath = Join-Path $appRoot 'server.mjs'
    $launcherPath = Join-Path $appRoot 'start-learning.ps1'
    $batchPath = Join-Path $appRoot ('启动学习.bat')
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { Write-Host '未找到 Node.js。请安装 Node.js 20 或更新版本：https://nodejs.org/'; return 1 }
    $nodeVersion = & $node.Source --version
    $versionMatch = [regex]::Match([string]$nodeVersion, '^v(\d+)\.')
    if ($LASTEXITCODE -ne 0 -or -not $versionMatch.Success -or [int]$versionMatch.Groups[1].Value -lt 20) { Write-Host 'Node.js 版本过旧，请升级至 Node.js 20 或更新版本。'; return 1 }
    $port = 4328
    if ($env:JAPANESE_PORT -and (-not [int]::TryParse($env:JAPANESE_PORT, [ref]$port) -or $port -lt 1 -or $port -gt 65535)) { Write-Host 'JAPANESE_PORT 必须为 1 到 65535 的端口号。'; return 1 }
    $digest = [Security.Cryptography.SHA256]::Create()
    try { $rootHash = [BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($appRoot.ToLowerInvariant()))).Replace('-','') }
    finally { $digest.Dispose() }
    $mutex = New-Object Threading.Mutex($false, ('Local\KotobaJapanese-' + $rootHash))
    $locked = $false; $child = $null; $childSnapshot = $null; $stateFile = $null
    try {
        Write-Host '正在检查上一次启动，请稍候…'
        try { $locked = $mutex.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw '另一个启动操作仍在进行，请等待约 30 秒后重试。' }
        $processes = @(Get-CimInstance Win32_Process)
        $oldServers = @($processes | Where-Object { Test-AppServer $_ $serverPath })
        $oldLaunchers = @($processes | Where-Object { [int]$_.ProcessId -ne $PID -and (Test-AppLauncher $_ $launcherPath) })
        # A launch waiting for this mutex is a future request, not an old instance.
        $self = $processes | Where-Object { [int]$_.ProcessId -eq $PID } | Select-Object -First 1
        $oldLaunchers = @($oldLaunchers | Where-Object { $_.CreationDate -lt $self.CreationDate })
        $protectedIds = New-Object 'Collections.Generic.HashSet[int]'
        $ancestor = $self
        for ($depth = 0; $ancestor -and $depth -lt 30; $depth++) {
            if (-not $protectedIds.Add([int]$ancestor.ProcessId)) { break }
            $ancestor = $processes | Where-Object { $_.ProcessId -eq $ancestor.ParentProcessId } | Select-Object -First 1
        }
        # A failed prior launch may be paused with no node/helper left alive.
        # Match its exact dedicated BAT command, not a window title or PID file.
        $oldShells = @($processes | Where-Object {
            -not $protectedIds.Contains([int]$_.ProcessId) -and $_.CreationDate -lt $self.CreationDate -and (Test-AppBatchWindow $_ $batchPath)
        })
        foreach ($old in @($oldServers) + @($oldLaunchers)) {
            $parent = $processes | Where-Object { $_.ProcessId -eq $old.ParentProcessId -and $_.CreationDate -le $old.CreationDate } | Select-Object -First 1
            if ($parent -and (Test-AppBatchWindow $parent $batchPath)) { $oldShells += $parent }
        }
        # Close the dedicated window first: a BAT replaced during an upgrade
        # must not resume reading its new bytes after the old node process exits.
        foreach ($old in ($oldShells | Sort-Object ProcessId -Unique)) { Stop-VerifiedProcess $old }
        foreach ($old in $oldLaunchers) { Stop-VerifiedProcess $old }
        foreach ($old in $oldServers) { Stop-VerifiedProcess $old }
        if ($oldServers.Count -or $oldLaunchers.Count -or $oldShells.Count) { Write-Host '已关闭本目录的上一次服务和启动窗口，正在重新启动。' }
        $releaseDeadline = [DateTime]::UtcNow.AddSeconds(5)
        do {
            $oldListener = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $oldServers.ProcessId })
            if (-not $oldListener.Count) { break }
            Start-Sleep -Milliseconds 100
        } while ([DateTime]::UtcNow -lt $releaseDeadline)
        $occupied = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if ($occupied) { throw "端口 $port 被其他程序占用。未关闭该程序。请先关闭占用程序，或设置 JAPANESE_PORT 后再启动。" }
        $privateRoot = Join-Path $appRoot 'local-config'
        [IO.Directory]::CreateDirectory($privateRoot) | Out-Null
        $stateFile = Join-Path $privateRoot 'startup-state.json'
        $outputLog = Join-Path $privateRoot 'startup.log'
        $errorLog = Join-Path $privateRoot 'startup-error.log'
        $child = Start-Process -FilePath $node.Source -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
        $childSnapshot = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $child.Id)
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        $ready = $false
        do {
            $child.Refresh()
            if ($child.HasExited) { throw "本地服务未能启动。错误信息保存在：$errorLog" }
            $ready = Test-AppReady $port $child.Id
            if (-not $ready) { Start-Sleep -Milliseconds 200 }
        } while (-not $ready -and [DateTime]::UtcNow -lt $deadline)
        if (-not $ready) { throw "服务在 20 秒内未就绪。请查看：$errorLog" }
        @{ root=$appRoot; launcherPid=$PID; serverPid=$child.Id; serverStarted=$child.StartTime.ToUniversalTime().ToString('o'); port=$port; ready=$true } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
        $address = "http://127.0.0.1:$port"
        Write-Host "`n学习软件已就绪：$address"
        Write-Host '再次双击启动文件会自动替换本次服务；学习记录和模型配置会保留。'
        Write-Host "启动日志：$outputLog"
        if (-not $SkipBrowser -and $env:KOTOBA_NO_OPEN -ne '1') {
            try { Start-Process $address } catch { Write-Host "无法自动打开浏览器，请手动访问：$address" }
        }
        $mutex.ReleaseMutex(); $locked = $false
        $child.WaitForExit()
        return 0
    } catch {
        Write-Host ("`n启动失败：" + $_.Exception.Message) -ForegroundColor Red
        return 1
    } finally {
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
        # Close only the process this invocation actually created, if still alive.
        if ($childSnapshot) { Stop-VerifiedProcess $childSnapshot }
    }
}

if ($MyInvocation.InvocationName -ne '.') { exit (Start-LearningApp -SkipBrowser:$NoOpen) }
