@echo off
rem Long-running production server launcher (Windows scheduled task).
rem Idempotent: skip when something is already listening on 3000 (the task repeats on a timer).
rem Production dist dir is .next-build (BUILD_ID Hq0x8CjGdb2Y13_BdSaCq, built 2026-11-14 17:07).
cd /d "%~dp0.."

node -e "const net=require('net');const s=net.connect({port:3000,host:'127.0.0.1'});const done=c=>{try{s.destroy()}catch{}process.exit(c)};s.setTimeout(1200);s.on('connect',()=>done(1));s.on('error',()=>done(0));s.on('timeout',()=>done(0))"
if errorlevel 1 exit /b 0

if exist "%TEMP%\erp-next-locks-user" del /q "%TEMP%\erp-next-locks-user\*.lock" >nul 2>&1
node scripts/next-run.mjs .next-build start >> "%~dp0..\tmp\server.out.log" 2>&1
