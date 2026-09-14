@echo off
setlocal
cd /d "%~dp0"

REM This window stays open whatever happens, so an error can be read.

if not exist "%~dp0serve.ps1" (
  echo.
  echo serve.ps1 is not next to this file.
  echo.
  echo This usually means Start.cmd was run from inside the zip. Extract the
  echo whole folder to disk first, then run Start.cmd from the extracted copy.
  echo.
  pause
  exit /b 1
)

echo Starting. Leave this window open while you work.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
set RC=%ERRORLEVEL%

if "%RC%"=="0" goto done

echo.
echo PowerShell did not start the server. Exit code %RC%.
echo Trying the other servers.
echo.

REM "python" on a machine with no Python is a Microsoft Store stub that opens
REM the Store instead of running anything, so test it properly rather than
REM just checking whether the name resolves.
python -c "exit(0)" >nul 2>&1
if not errorlevel 1 (
  echo Using python serve.py
  python serve.py %*
  goto done
)

node --version >nul 2>&1
if not errorlevel 1 (
  echo Using node serve.mjs
  node serve.mjs %*
  goto done
)

echo.
echo No runtime could start the server.
echo.
echo If your organisation enforces a PowerShell execution policy through
echo group policy, -ExecutionPolicy Bypass is ignored and this cannot run.
echo Check with:
echo.
echo     powershell -NoProfile -Command "Get-ExecutionPolicy -List"
echo.
echo If MachinePolicy or UserPolicy is AllSigned or Restricted, that is the
echo cause, and the folder needs to be hosted on a web server instead, or
echo Python or Node installed.
echo.

:done
echo.
echo Server stopped.
pause
endlocal
