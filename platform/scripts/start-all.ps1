<#
.SYNOPSIS
    Start the full grid-intelligence-platform stack - Postgres (if down),
    FastAPI, ingestion scheduler - and verify each.

.DESCRIPTION
    Idempotent: if a service is already healthy on its port, it's left alone.
    Otherwise it's killed and restarted via the same hidden cmd launcher that
    Windows Startup uses. Prints a status table at the end.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1 -Restart
#>
[CmdletBinding()]
param(
    [switch] $Restart,
    [int]    $ApiPort       = 8787,
    [int]    $PgPort        = 5432,
    [string] $PgHome        = "$env:USERPROFILE\PostgreSQL\17"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    $m" -ForegroundColor Green }
function Warn($m) { Write-Host "    $m" -ForegroundColor Yellow }
function Bad($m)  { Write-Host "    $m" -ForegroundColor Red }

function Test-Url($url) {
    try { (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5).StatusCode } catch { $null }
}

function Stop-Port($port) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
      ForEach-Object {
        if ($_.OwningProcess -gt 4) {
            try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop; Warn "killed pid $($_.OwningProcess) on :$port" } catch {}
        }
      }
}

function Start-Hidden($cmdPath) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c","`"$cmdPath`"" -WindowStyle Hidden
}

# ---------------------------------------------------------------------------
# 1. Postgres
# ---------------------------------------------------------------------------
Step "PostgreSQL on :$PgPort"
$pgctl = "$PgHome\bin\pg_ctl.exe"
$pgisr = "$PgHome\bin\pg_isready.exe"
$pgdata = "$PgHome\data"
& $pgisr -h 127.0.0.1 -p $PgPort 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Warn "Postgres not running - starting ..."
    & $pgctl -D $pgdata -o "-p $PgPort" -l "$pgdata\server.log" start | Out-Null
    Start-Sleep -Seconds 3
}
& $pgisr -h 127.0.0.1 -p $PgPort 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Ok "ready" } else { Bad "FAILED to bring up Postgres"; exit 1 }

# ---------------------------------------------------------------------------
# 2. FastAPI
# ---------------------------------------------------------------------------
Step "FastAPI on :$ApiPort"
if ($Restart) { Stop-Port $ApiPort }
$code = Test-Url "http://127.0.0.1:$ApiPort/healthz"
if ($code -eq 200) {
    Ok "already healthy (HTTP 200)"
} else {
    Stop-Port $ApiPort
    Start-Hidden "$repo\scripts\start-api.cmd"
    Start-Sleep -Seconds 5
    for ($i=0; $i -lt 6; $i++) {
        $code = Test-Url "http://127.0.0.1:$ApiPort/healthz"
        if ($code -eq 200) { Ok "up (HTTP 200)"; break }
        Start-Sleep -Seconds 2
    }
    if ($code -ne 200) { Bad "FAILED - see logs\api.log" }
}

# ---------------------------------------------------------------------------
# 3. Ingestion scheduler (no port - check by process)
# ---------------------------------------------------------------------------
Step "Ingestion scheduler"
$alive = Get-WmiObject Win32_Process -Filter "Name='python.exe'" |
         Where-Object { $_.CommandLine -match "gridintel\.cli.*scheduler" }
if ($alive -and -not $Restart) {
    Ok "already running (pid $($alive.ProcessId))"
} else {
    if ($alive) {
        foreach ($p in $alive) { try { Stop-Process -Id $p.ProcessId -Force } catch {} }
        Warn "restarted (was pid $($alive.ProcessId))"
    }
    Start-Hidden "$repo\scripts\start-scheduler.cmd"
    Start-Sleep -Seconds 3
    $alive = Get-WmiObject Win32_Process -Filter "Name='python.exe'" |
             Where-Object { $_.CommandLine -match "gridintel\.cli.*scheduler" }
    if ($alive) { Ok "up (pid $($alive.ProcessId))" } else { Bad "FAILED - see logs\scheduler.log" }
}

# ---------------------------------------------------------------------------
# 4. Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================================"
Write-Host " grid-intelligence-platform - service status"
Write-Host "============================================================"
$rows = @(
    [pscustomobject]@{ Service='Postgres + TimescaleDB'; URL="127.0.0.1:$PgPort";                Status=(& $pgisr -h 127.0.0.1 -p $PgPort 2>&1 | Out-String).Trim() }
    [pscustomobject]@{ Service='FastAPI';                URL="http://127.0.0.1:$ApiPort/docs";   Status="HTTP $(Test-Url ""http://127.0.0.1:$ApiPort/healthz"")" }
)
$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
Write-Host "Logs: $repo\logs\{api,scheduler}.log"
