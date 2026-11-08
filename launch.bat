@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.3 or later is required. Install it, then run this launcher again.
  pause
  exit /b 1
)
if not exist node_modules\electron (
  echo Installing dependencies...
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node src\desktop.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
