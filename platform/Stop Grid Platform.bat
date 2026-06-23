@echo off
title Grid Intelligence Platform - stopping...
color 0C
echo.
echo  Stopping API / scheduler (Postgres left running)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-WmiObject Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'grid-intelligence-platform' -or $_.CommandLine -match 'gridintel\.cli' } | ForEach-Object { Write-Host (\"  stopping pid \" + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-WmiObject Win32_Process -Filter \"Name='cmd.exe'\" | Where-Object { $_.CommandLine -match 'start-(api|scheduler)\.cmd' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host ''; Write-Host '  stopped.' -ForegroundColor Green"
echo.
pause
