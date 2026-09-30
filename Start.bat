@echo off
rem Starts VOD Review Tool and opens it in your browser. It keeps running without a window: stop it with the
rem power button in the app (it also stops by itself 45 minutes after its last tab is closed).
rem "Start.bat console" runs it in this window instead and shows everything it does.
setlocal
cd /d "%~dp0"
title VOD Review Tool

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Get the LTS version from https://nodejs.org , install it, then run Start.bat again.
  echo.
  pause
  exit /b 1
)

rem Node 22.13 or newer: it has the database built in
for /f "tokens=1,2 delims=v." %%a in ('node -v') do (
  set MAJOR=%%a
  set MINOR=%%b
)
set OK=0
if %MAJOR% GTR 22 set OK=1
if %MAJOR% EQU 22 if %MINOR% GEQ 13 set OK=1
if %OK%==0 (
  echo.
  echo  Your Node.js is too old ^(%MAJOR%.%MINOR%^). Install the current LTS from https://nodejs.org and run Start.bat again.
  echo.
  pause
  exit /b 1
)

if /i "%~1"=="console" (
  node --disable-warning=ExperimentalWarning src\server.js
  pause
  exit /b
)

node src\launch.js %*
if errorlevel 1 (
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul 2>nul
exit /b 0
