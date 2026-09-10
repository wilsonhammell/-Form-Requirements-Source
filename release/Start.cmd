@echo off
REM Starts the designer. Uses Windows PowerShell, which is already on every
REM Windows machine, so nothing has to be installed.
REM
REM -ExecutionPolicy Bypass applies to this one process only. It changes no
REM machine setting and needs no administrator rights. It is required because
REM a file that arrived by download or email is marked as coming from the
REM internet, and the default policy refuses to run such a script.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
if errorlevel 1 (
  echo.
  echo Could not start. If your organisation enforces a PowerShell execution
  echo policy by group policy, use one of these instead, if installed:
  echo     python serve.py
  echo     node serve.mjs
  pause
)
