<#
.SYNOPSIS
    Install the TimescaleDB extension into an existing user-owned PostgreSQL 17
    install on Windows - without admin rights.

.DESCRIPTION
    The vendor installer (setup.exe) requires admin. This script extracts the
    same binaries from the official release zip and drops them into the
    user-owned PostgreSQL 17 directory layout, then patches shared_preload_libraries
    and restarts the cluster. Idempotent.

    Tested with PostgreSQL 17.5 + TimescaleDB 2.18.2 on Windows 11 Pro.

.PARAMETER PgHome
    Root of the PostgreSQL install (the parent of bin/, lib/, share/, data/).

.PARAMETER TsVersion
    TimescaleDB release tag, e.g. "2.18.2".

.EXAMPLE
    ./scripts/install-timescaledb.ps1
.EXAMPLE
    ./scripts/install-timescaledb.ps1 -PgHome "C:\Users\Me\PostgreSQL\17" -TsVersion "2.18.2"
#>
[CmdletBinding()]
param(
    [string] $PgHome    = "$env:USERPROFILE\PostgreSQL\17",
    [string] $TsVersion = "2.18.2",
    [string] $PgMajor   = "17"
)

$ErrorActionPreference = "Stop"
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

$bin     = Join-Path $PgHome "bin"
$lib     = Join-Path $PgHome "lib"
$ext     = Join-Path $PgHome "share\extension"
$data    = Join-Path $PgHome "data"
$pgctl   = Join-Path $bin "pg_ctl.exe"
$conf    = Join-Path $data "postgresql.conf"
$workDir = Join-Path $env:TEMP "gridintel-timescaledb"

if (-not (Test-Path $pgctl)) { throw "Could not find pg_ctl at $pgctl" }

# 1. Download release zip if not already cached
$zipName = "timescaledb-postgresql-$PgMajor-windows-amd64.zip"
$zipPath = Join-Path $workDir $zipName
if (-not (Test-Path $zipPath)) {
    Step "Downloading TimescaleDB $TsVersion for PostgreSQL $PgMajor..."
    New-Item -ItemType Directory -Force -Path $workDir | Out-Null
    $url = "https://github.com/timescale/timescaledb/releases/download/$TsVersion/$zipName"
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
} else {
    Step "Cached download already present at $zipPath."
}

# 2. Extract
$extractDir = Join-Path $workDir "extracted-$TsVersion"
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
$srcDir = Join-Path $extractDir "timescaledb"

# 3. Stop the server (only if it's running) so DLLs can be replaced
$status = & $pgctl -D $data status 2>&1
if ($LASTEXITCODE -eq 0) {
    Step "Stopping PostgreSQL to swap DLLs..."
    & $pgctl -D $data stop -m fast | Out-Null
    Start-Sleep -Seconds 2
}

# 4. Copy files (DLLs go in both lib/ and bin/ to satisfy Windows search paths)
Step "Installing extension files into $PgHome ..."
Get-ChildItem $srcDir -Filter "timescaledb*.dll" | ForEach-Object {
    Copy-Item $_.FullName $lib -Force
    Copy-Item $_.FullName $bin -Force
}
Get-ChildItem $srcDir -Filter "timescaledb.control" | Copy-Item -Destination $ext -Force
Get-ChildItem $srcDir -Filter "timescaledb*.sql"    | Copy-Item -Destination $ext -Force
$tune = Join-Path $srcDir "timescaledb-tune.exe"
if (Test-Path $tune) { Copy-Item $tune $bin -Force }

# 5. Patch postgresql.conf to preload timescaledb if not already
$confText = Get-Content $conf -Raw
if ($confText -notmatch "^shared_preload_libraries\s*=\s*'[^']*timescaledb") {
    Step "Enabling timescaledb in shared_preload_libraries ..."
    if ($confText -match "^shared_preload_libraries\s*=") {
        $confText = $confText -replace "^shared_preload_libraries\s*=\s*'([^']*)'", "shared_preload_libraries = '`$1,timescaledb'"
        $confText = $confText -replace ",{2,}", ","
        $confText = $confText -replace "'(,)", "'"
    } else {
        $confText = $confText -replace "#shared_preload_libraries\s*=\s*''.*", "shared_preload_libraries = 'timescaledb'    # added by install-timescaledb.ps1"
    }
    Set-Content -Path $conf -Value $confText -Encoding ascii
}

# 6. Start the server
Step "Starting PostgreSQL ..."
$logFile = Join-Path $data "server.log"
& $pgctl -D $data -o "-p 5432" -l $logFile start | Out-Null
Start-Sleep -Seconds 3

# 7. Verify
$ready = & (Join-Path $bin "pg_isready.exe") -h 127.0.0.1 -p 5432
Step "pg_isready: $ready"
Step "Now run, against your target db:  CREATE EXTENSION IF NOT EXISTS timescaledb;"
