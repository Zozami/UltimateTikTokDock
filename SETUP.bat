@echo off
rem ------------------------------------------------------------
rem  TikFinity Dock - ONE-TIME SETUP.  Double-click this file.
rem  Installs the chat bridge, checks your stream key token,
rem  optionally installs the like engine, then tells you the
rem  three clicks left to do inside TikFinity and OBS.
rem
rem  Safe to run more than once.
rem  Extra switches (rarely needed):
rem    SETUP.bat -Yes        answer yes to everything
rem    SETUP.bat -SkipLike   chat bridge only
rem ------------------------------------------------------------
title TikFinity Dock - Setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause