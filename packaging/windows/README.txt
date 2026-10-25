SPOOKY TREAT STATION - QUICK START
==================================

A Halloween display for your front door: a big screen + a webcam + speakers.
It invites trick-or-treaters, tells kids and adults apart, tells them to take
one treat, and scares them (gently for kids, properly for adults).
Everything runs on this computer. No internet, no account, no cloud.

WHAT YOU NEED
  - Windows 10 or 11 PC (an Intel Celeron with 8 GB RAM is enough)
  - A USB webcam pointed at the driveway / path
  - A monitor or TV (the bigger the better) and speakers
  - Microsoft Edge (already on every Windows PC) or Google Chrome

FIRST START
  1. Unzip this folder somewhere permanent, e.g. C:\SpookyTreatStation
  2. Double-click "Setup Mode.bat".
     (If Windows says "Windows protected your PC": click "More info" -> "Run anyway".
      The program is not signed by a company, which is why Windows asks.)
  3. Follow the "Start here" tab:
       - pick your camera
       - drag the coloured lines on the camera picture (Zones)
       - optional: switch on "Watch the candy jar" and drag the blue box over the jar
       - calibrate kids vs adults (an adult stands at 2-3 distances, press Capture)
       - press SAVE
  4. Press Close: the show starts right away, full screen. No restart needed.
     Changes always apply immediately - even when saved from another window
     while the show is running. Next time, just start SpookyTreatStation.exe.

ON HALLOWEEN NIGHT
  - Double-click SpookyTreatStation.exe. That's it.
  - Want it to start by itself when the PC turns on? Run "Start with Windows - ON.bat".

KEYBOARD (while the show is running)
  S        setup screen on/off
  F        full screen on/off
  M        mute
  D        small camera view in the corner (to check what the camera sees)
  1        invite scene
  2 3 4 5  kids:   welcome, take-one, BOO!, goodbye
  6 7 8 9  adults: welcome, take-one, SCARE!, goodbye
  0        back to automatic
  Alt+F4   close the browser window (then close the black console window)

YOUR OWN VIDEOS / SOUNDS
  Put .mp4 videos, pictures or .mp3 sounds into the folders inside "media"
  (one folder per stage, e.g. media\scare-adults). Then in Setup -> "My media",
  set that stage to "My media" or "Mix".

FILES
  SpookyTreatStation.exe   the program (starts a tiny local web server + opens Edge)
  settings.json            your settings (created when you press Save) - back it up!
  media\                   your own videos / pictures / sounds
  browser-profile\         private browser data for the show (safe to delete)
  piper\, voices\          the offline natural-voice engine and its voice (Piper, LibriTTS voice)
  voice-cache\             the generated sentences (safe to delete; they are made again)

TIPS FOR A HIDDEN, RELIABLE SETUP
  - Windows Settings -> Accounts -> Sign-in options: turn on automatic sign-in
    (or use "netplwiz"), so the PC starts the show after a power cut.
  - The program keeps the PC and the screen awake while it runs.
  - Turn off Windows Update restarts for the evening (Settings -> Windows Update -> Pause).
  - CAMERA: people must be seen head to toe while walking up (that's how kids vs adults works).
    Do NOT tilt it steeply down (at 45 degrees you only see legs).
    Logitech C270 (narrow lens): best 2-3 m BEHIND the screen, about 2 m high (house wall,
    door frame), tilted 10-15 degrees down, looking over the screen along the path.
    Simple alternative: on top of the monitor, tilted only about 5 degrees down.
    Keep Setup -> Start here -> Camera picture on "Standard 4:3" for a C270/C310.
    Redo the calibration after moving the camera.
  - A small lamp or porch light helps the camera a lot at night.
  - Test with the D key: you should see a box around each person.

TROUBLESHOOTING
  No camera picture        -> Setup -> Start here -> pick the camera. Close other apps using it (Zoom/Teams/Camera).
  No sound                 -> check speaker volume and Setup -> Sound & voice. Press a key once if it says "Click to start".
  Voice sounds robotic     -> Setup -> Sound & voice: should say "Natural voices". The first start prepares
                              all sentences (a few minutes on a slow PC); until then a Windows voice is used.
                              Try other speakers with "Another voice" and Save.
  Only legs on camera      -> camera tilted too far down. See the CAMERA tip above.
  Nobody detected          -> more light; lower "Detection confidence" in Setup -> Advanced; GPU option off.
  Kids shown as adults     -> redo calibration (Setup -> Kids vs adults), or adjust "Kids are shorter than".
  Scares too often         -> increase "Don't scare same group again for" (Setup -> Scare).
  Started it twice         -> no problem: the running show is used (Setup Mode.bat opens its setup screen).

Full guide and source code: see README.md on the project's GitHub page.
