@echo off
cd /d "%~dp0"
start "Forest float bridge" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1"
start "" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ForestFloat.ps1"
