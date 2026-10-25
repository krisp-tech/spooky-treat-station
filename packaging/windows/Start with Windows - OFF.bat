@echo off
rem Removes Spooky Treat Station from the Windows Startup folder.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Spooky Treat Station.lnk" 2>nul
echo Spooky Treat Station will no longer start automatically.
pause
