@echo off
rem Long-running production server launcher (used by the Windows scheduled task).
rem Clears a stale Next output lock left by a crashed build before starting.
cd /d "%~dp0.."
if exist "%TEMP%\erp-next-locks-user" del /q "%TEMP%\erp-next-locks-user\*.lock" 2>nul
node scripts/next-run.mjs .next-build start >> "%~dp0..\tmp\server.out.log" 2>&1
