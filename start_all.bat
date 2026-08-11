@echo off
rem CAST LIGHT - one-click start: PocketBase backend + local web server
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo [WARN] python not found in PATH. Web server will not start.
  echo        Install Python 3 or start it manually:
  echo        python -m http.server 8080 --directory web
)

echo Starting PocketBase backend (http://127.0.0.1:8090) ...
start "PocketBase" /min pb\pocketbase.exe serve

timeout /t 2 /nobreak >nul

echo Starting web server (http://localhost:8080) ...
start "Web Server" /min python -m http.server 8080 --directory web

timeout /t 2 /nobreak >nul
start http://localhost:8080

echo.
echo ============================================================
echo  CAST LIGHT started
echo   - Website:          http://localhost:8080
echo   - Admin dashboard:  http://127.0.0.1:8090/_/
echo  First time setup:
echo   1) Open the admin dashboard and login (see setup_pocketbase.ps1)
echo   2) Run:  python import_pocketbase.py
echo ============================================================
pause
