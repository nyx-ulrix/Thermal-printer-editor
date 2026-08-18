@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Receipt Printer Editor
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or later, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
  echo.
)

echo Starting the app...
call npm run dev
if errorlevel 1 (
  echo The app failed to start.
  pause
  exit /b 1
)
