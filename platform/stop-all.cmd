@echo off
REM Stop the API / scheduler (Postgres is left running).
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-WmiObject Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'grid-intelligence-platform' -or $_.CommandLine -match 'gridintel' } | ForEach-Object { Write-Host \"stopping pid $($_.ProcessId): $($_.Name)\"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-WmiObject Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -match 'start-(api|scheduler)\.cmd' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host 'stopped.'"
pause
endlocal
