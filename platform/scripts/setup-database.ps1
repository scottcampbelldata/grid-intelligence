<#
.SYNOPSIS
    One-shot bootstrap of the grid_intel database, grid_app role, schemas,
    TimescaleDB hypertables, and continuous-aggregate policies.

.DESCRIPTION
    Reuses an existing local PostgreSQL 17 cluster (the same one the
    manufacturing-intelligence-pipeline project uses). Idempotent.

.PARAMETER SuperPassword
    Password for the postgres superuser. If omitted, you'll be prompted.

.PARAMETER AppPassword
    Password to assign to grid_app. If omitted, a 32-byte random one is generated
    and printed to stdout (and persisted into CREDENTIALS.txt / .env).
#>
[CmdletBinding()]
param(
    [string] $SuperPassword,
    [string] $AppPassword,
    [string] $Database  = "grid_intel",
    [string] $AppRole   = "grid_app",
    [string] $PgHome    = "$env:USERPROFILE\PostgreSQL\17",
    [int]    $Port      = 5432
)

$ErrorActionPreference = "Stop"
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

$psql = Join-Path $PgHome "bin\psql.exe"
if (-not (Test-Path $psql)) { throw "psql not found at $psql" }

if (-not $SuperPassword) {
    $sec = Read-Host -Prompt "Postgres SUPERUSER (postgres) password" -AsSecureString
    $SuperPassword = [System.Net.NetworkCredential]::new("", $sec).Password
}

if (-not $AppPassword) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $AppPassword = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    Step "Generated app password (record this): $AppPassword"
}

$env:PGPASSWORD = $SuperPassword

Step "Creating role $AppRole if missing ..."
$roleSql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$AppRole') THEN
    CREATE ROLE $AppRole LOGIN PASSWORD '$AppPassword';
  ELSE
    ALTER ROLE $AppRole WITH LOGIN PASSWORD '$AppPassword';
  END IF;
END `$`$;
"@
& $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c $roleSql | Out-Null

Step "Creating database $Database if missing ..."
$exists = & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'"
if ($exists.Trim() -ne "1") {
    & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -c "CREATE DATABASE $Database OWNER $AppRole;" | Out-Null
}

Step "Enabling TimescaleDB extension ..."
& $psql -h 127.0.0.1 -p $Port -U postgres -d $Database -c "CREATE EXTENSION IF NOT EXISTS timescaledb;" | Out-Null

$repo = Split-Path -Parent $PSScriptRoot
Step "Applying schema.sql ..."
& $psql -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -f (Join-Path $repo "gridintel\db\schema.sql") | Out-Null

Step "Granting privileges to $AppRole ..."
$grants = @"
GRANT USAGE, CREATE ON SCHEMA raw, staging, marts, ml, ops TO $AppRole;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA raw, staging, marts, ml, ops TO $AppRole;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA raw, staging, marts, ml, ops TO $AppRole;
ALTER DEFAULT PRIVILEGES IN SCHEMA raw, staging, marts, ml, ops GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO $AppRole;
ALTER DEFAULT PRIVILEGES IN SCHEMA raw, staging, marts, ml, ops GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO $AppRole;
GRANT CREATE ON DATABASE $Database TO $AppRole;
"@
& $psql -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -c $grants | Out-Null

Step "Applying Timescale compression + continuous-aggregate policies ..."
& $psql -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -f (Join-Path $repo "gridintel\db\policies.sql") | Out-Null

Remove-Item Env:PGPASSWORD

Step "Done. Update .env (PGUSER=$AppRole, PGPASSWORD=$AppPassword) if needed."
