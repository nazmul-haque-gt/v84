@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org then run this again.
  pause & exit /b 1
)
echo Installing dependencies (needs internet, a few minutes the first time)...
call npm install || (echo npm install failed & pause & exit /b 1)
echo Building the installer and portable exe...
call npm run dist || (echo build failed & pause & exit /b 1)
echo.
echo Done. Your files are in the "dist" folder:
dir /b dist\*.exe
explorer dist
pause
