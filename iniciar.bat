@echo off
cd /d "%~dp0"
start "" cmd /c "timeout /t 1 >nul & start http://localhost:8000"
py servidor.py 8000
