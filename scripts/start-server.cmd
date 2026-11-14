@echo off
rem Long-running production server launcher (Windows scheduled task).
rem Idempotent: skip when something is already listening on 3000 (the task repeats on a timer).
rem Uses the standalone server, matching production systemd (npm run start:standalone):
rem "next start" is unsupported for output:standalone and hangs server actions.
cd /d "%~dp0.."

node -e "const net=require('net');const s=net.connect({port:3000,host:'127.0.0.1'});const done=c=>{try{s.destroy()}catch{}process.exit(c)};s.setTimeout(1200);s.on('connect',()=>done(1));s.on('error',()=>done(0));s.on('timeout',()=>done(0))"
if errorlevel 1 exit /b 0

if exist "%TEMP%\erp-next-locks-user" del /q "%TEMP%\erp-next-locks-user\*.lock" >nul 2>&1

rem The standalone bundle ships without static/ and public/; mirror them once after each build.
if not exist ".next-build\standalone\.next-build\static" xcopy /E /I /Y ".next-build\static" ".next-build\standalone\.next-build\static" >nul
if not exist ".next-build\standalone\public" xcopy /E /I /Y "public" ".next-build\standalone\public" >nul

node scripts/runtime/start-standalone.mjs >> "%~dp0..\tmp\server.out.log" 2>&1
