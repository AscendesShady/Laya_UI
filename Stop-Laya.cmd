@echo off
cd /d "%~dp0"
node stop-laya.mjs
exit /b %errorlevel%
