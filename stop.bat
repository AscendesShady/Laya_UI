@echo off
cd /d "%~dp0"
node src\stop-laya.mjs
exit /b %errorlevel%
