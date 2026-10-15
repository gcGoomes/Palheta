@echo off
cd /d "%~dp0"

rem Usa o "py" (instalador do python.org) ou o "python" (Microsoft Store / PATH).
rem O teste "-c" descarta o atalho da Store que existe mesmo sem Python instalado.
set "PY="
py -c "import sys" >nul 2>nul && set "PY=py"
if not defined PY python -c "import sys" >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python nao encontrado.
  echo Instale em https://www.python.org/downloads/ e marque "Add python.exe to PATH".
  pause
  exit /b 1
)

start "" cmd /c "timeout /t 1 >nul & start http://localhost:8000"
%PY% servidor.py 8000
if errorlevel 1 pause
