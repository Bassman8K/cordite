@echo off
rem Builds and starts the CORDITE desktop app from this checkout (Windows).
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is needed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing dependencies...
  call npm ci
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)
call npm run desktop
