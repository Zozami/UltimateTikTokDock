@echo off
rem ------------------------------------------------------------
rem  TikFinity Dock - CLEAN UNINSTALL.  Double-click this file.
rem
rem  Removes everything SETUP.bat installed:
rem    - the two Startup-folder launchers
rem    - the running chat bridge and like engine
rem    - the like engine's downloads, its logged-in browser session,
rem      your Streamlabs token and the log files
rem
rem  It leaves OBS, TikFinity and the dock's own files alone - deleting
rem  the folder is one click in Explorer, which is safer than a script
rem  deleting the files it is running from.
rem
rem  Switches (rarely needed):
rem    UNINSTALL.bat -Yes        do not ask anything
rem    UNINSTALL.bat -KeepFiles  only stop things, keep all files
rem ------------------------------------------------------------
title TikFinity Dock - Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
echo.
pause