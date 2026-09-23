@echo off
rem ============================================================
rem  KEPLER-9c / alien-walk  launcher
rem  Double-click this file. It starts the local server in its own
rem  window and then opens the game in your default browser.
rem
rem  NOTE: content is intentionally ASCII-only so that no codepage
rem  issue can garble the script.
rem ============================================================
setlocal
cd /d "%~dp0"

set "PORT=8766"
set "PY=E:\anaconda\python.exe"
if not exist "%PY%" set "PY=python"

echo Starting local server on http://127.0.0.1:%PORT%/ ...
echo Close the server window to stop playing.
echo.

start "alien-walk server" "%PY%" "%~dp0serve.py" %PORT%

rem give the server a moment to bind the port
timeout /t 2 /nobreak >nul

start "" "http://127.0.0.1:%PORT%/"
endlocal
