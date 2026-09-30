@echo off
rem Starts Shadow Room in your browser (localhost counts as a secure context, so the webcam works).
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the local server: https://nodejs.org
  pause
  exit /b 1
)
node tools\serve.mjs --open
