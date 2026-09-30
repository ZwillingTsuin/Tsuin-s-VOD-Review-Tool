@echo off
rem Updates the app to the newest version (for a copy downloaded with git clone). Your data is not in this folder.
setlocal
cd /d "%~dp0"
title VOD Review Tool update
where git >nul 2>nul
if errorlevel 1 goto nogit
if not exist ".git" goto nogit

echo  Getting the newest version...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo  The update did not go through. If you changed files in this folder, undo that ^(git checkout .^) and try again.
  echo.
  pause
  exit /b 1
)
for /f %%v in ('node -p "require('./package.json').version" 2^>nul') do set VERSION=%%v
echo.
echo  Up to date: version %VERSION%. What changed is in CHANGELOG.md.
echo  If the app is running, stop it with the power button and start it again with Start.bat.
echo.
pause
exit /b 0

:nogit
echo.
echo  This copy was not downloaded with git. To update, download the new version and replace this folder with it.
echo  Your data (accounts, notes, downloaded matches) is stored elsewhere and stays as it is.
echo.
pause
