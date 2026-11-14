@echo off
rem Long-running Sellfox sync worker launcher (used by the Windows scheduled task).
cd /d "%~dp0.."
node scripts/runtime/worker-manager.mjs sellfox-sync >> "%~dp0..\tmp\worker.out.log" 2>&1
