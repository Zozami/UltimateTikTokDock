@echo off
rem ------------------------------------------------------------
rem  TikFinity Dock - UPDATE.  Double-click this file.
rem
rem  Gets the newest version straight from GitHub: checks what is
rem  installed, downloads the new build, replaces only the files
rem  that shipped, and restarts the chat bridge for you. Your
rem  tokens, logs and settings are never touched.
rem
rem  Nothing is deleted, and this is safe to run any time.
rem  Extra switches (rarely needed):
rem    UPDATE.bat -Check       only look, change nothing
rem    UPDATE.bat -Force       reinstall even if already current
rem    UPDATE.bat -SkipRestart leave the chat bridge running
rem ------------------------------------------------------------
title TikFinity Dock - Update
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
echo.
pause
