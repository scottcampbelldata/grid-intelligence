@echo off
REM Start the long-lived APScheduler service that runs every ingestion + ML job.
setlocal
set "REPO=%~dp0.."
pushd "%REPO%"
if not exist logs mkdir logs
"%REPO%\.venv\Scripts\python.exe" -m gridintel.cli scheduler >> "%REPO%\logs\scheduler.log" 2>&1
popd
endlocal
