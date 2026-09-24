@echo off
cd /d "%~dp0.."
call node scripts/backup.js
if errorlevel 1 (
  echo Backup failed.
  exit /b 1
)
echo Backup verified successfully.
pause
