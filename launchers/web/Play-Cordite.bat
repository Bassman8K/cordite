@echo off
rem Serves this folder on your own machine and opens CORDITE in the browser (Windows).
cd /d "%~dp0"
set PORT=4173
if not exist index.html (
  echo Put this script next to the game's index.html and run it again.
  pause
  exit /b 1
)
where py >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:%PORT%/"
  py -3 -m http.server %PORT% --bind 127.0.0.1
  exit /b
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:%PORT%/"
  python -m http.server %PORT% --bind 127.0.0.1
  exit /b
)
where npx >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:%PORT%/"
  call npx --yes serve -l %PORT% .
  exit /b
)
echo Python 3 or Node.js is needed to serve the game. Install either one and run this again.
pause
