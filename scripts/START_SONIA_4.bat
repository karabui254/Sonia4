@echo off
cd /d "%~dp0.."
if not exist node_modules (
  echo Installing Sonia 4.0 dependencies...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
echo Starting Sonia 4.0 Farm...
call npm start
pause
