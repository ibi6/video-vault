@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 from https://nodejs.org first.
  pause
  exit /b 1
)
if not exist node_modules\express (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
if not defined PORT set PORT=3210
echo Opening Video Vault: http://127.0.0.1:%PORT%
echo Keep this window open. Press Ctrl+C to stop.
start "" /b powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%'"
call npm start
pause
