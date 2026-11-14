@echo off
rem Long-running Sellfox sync worker launcher (Windows scheduled task).
rem Idempotent: worker-manager writes tmp\worker-<id>.pid; skip when that pid is still alive.
cd /d "%~dp0.."

node -e "const fs=require('fs');const p='tmp/worker-sellfox-sync.pid';if(!fs.existsSync(p))process.exit(0);const pid=Number(fs.readFileSync(p,'utf8').trim());if(!pid)process.exit(0);try{process.kill(pid,0);process.exit(1)}catch{process.exit(0)}"
if errorlevel 1 exit /b 0

node scripts/runtime/worker-manager.mjs sellfox-sync >> "%~dp0..\tmp\worker.out.log" 2>&1
