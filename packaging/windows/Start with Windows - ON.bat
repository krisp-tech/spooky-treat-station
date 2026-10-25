@echo off
rem Adds Spooky Treat Station to the Windows Startup folder, so the show starts automatically after login.
rem Paths are passed through environment variables so folder names with ' or spaces work.
set "STS_EXE=%~dp0SpookyTreatStation.exe"
set "STS_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup') + '\Spooky Treat Station.lnk'); $s.TargetPath=$env:STS_EXE; $s.WorkingDirectory=$env:STS_DIR; $s.WindowStyle=7; $s.Save()"
if errorlevel 1 (
  echo Something went wrong. You can add it by hand: press Win+R, type shell:startup, and put a shortcut to SpookyTreatStation.exe there.
) else (
  echo Done! Spooky Treat Station will start automatically when you log in to Windows.
  echo Tip: also turn on automatic sign-in so it starts after a power cut. See README.txt.
)
pause
