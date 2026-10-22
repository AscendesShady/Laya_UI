@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required. Install it, then run this launcher again.
  pause
  exit /b 1
)
node desktop.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
