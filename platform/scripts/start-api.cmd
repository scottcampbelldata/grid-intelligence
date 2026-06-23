@echo off
REM Start the FastAPI service (uvicorn) - the data layer for the React frontend.
setlocal
set "REPO=%~dp0.."
pushd "%REPO%"
if not exist logs mkdir logs
"%REPO%\.venv\Scripts\python.exe" -m uvicorn gridintel.api.main:app ^
  --host 127.0.0.1 ^
  --port 8787 ^
  >> "%REPO%\logs\api.log" 2>&1
popd
endlocal
