@echo off
REM Double-click this from Explorer to bring up the whole grid-intel stack.
REM Or from PowerShell: .\start-all.cmd      (add --restart to force restart all)
setlocal
set "REPO=%~dp0"
set "ARGS="
if "%~1"=="--restart" set "ARGS=-Restart"
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO%scripts\start-all.ps1" %ARGS%
echo.
pause
endlocal
