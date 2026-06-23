@echo off
title Grid Intelligence Platform - starting...
color 0B
echo.
echo  ============================================================
echo    Grid Intelligence Platform
echo    Starting Postgres + FastAPI + Scheduler...
echo  ============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-all.ps1"
echo.
echo  ------------------------------------------------------------
echo    Frontend (React/Cloudflare): https://grid.scottcampbell.io
echo    API docs:             http://127.0.0.1:8787/docs
echo  ------------------------------------------------------------
echo.
pause
