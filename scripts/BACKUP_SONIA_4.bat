@echo off
cd /d "%~dp0.."
if not exist backups mkdir backups
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set d=%%d-%%b-%%c
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set t=%%a%%b
copy /Y "data\sonia4.db" "backups\sonia4-%d%-%t%.db"
echo Backup complete.
pause
