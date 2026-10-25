SPOOKY TREAT STATION - QUICK START (LINUX)
==========================================

A Halloween display for your front door: a big screen + a webcam + speakers.
It invites trick-or-treaters, tells kids and adults apart, tells them to take
one treat, and scares them (gently for kids, properly for adults).
Everything runs on this computer. No internet, no account, no cloud.

WHAT YOU NEED
  - A 64-bit PC (x86-64) with Ubuntu, Linux Mint, Debian, Fedora or similar
    (an Intel Celeron with 4-8 GB RAM is enough; uses about 1-2 GB while running)
  - Google Chrome, Chromium or Microsoft Edge  <- install.sh checks this and can
    install Google Chrome for you (one command, needs your password)
  - A USB webcam pointed at the driveway / path
  - A monitor or TV (the bigger the better) and speakers
  (Raspberry Pi / ARM is not supported by this package.)

FIRST START (about 10 minutes, then set up the camera and zones)
  1. Unpack the folder somewhere permanent, e.g. your home folder:
         tar -xzf SpookyTreatStation-*-linux-x64.tar.gz -C ~
     (it becomes ~/SpookyTreatStation)
  2. Open a terminal in that folder and run once:
         cd ~/SpookyTreatStation
         ./install.sh
     It checks for Chrome (offers to install it) and adds "Spooky Treat Station"
     and "Spooky Treat Station Setup" to your applications menu and desktop.
  3. Open "Spooky Treat Station Setup" (or run ./setup-mode.sh) and follow the
     "Start here" tab: camera, zones, kids-vs-adults calibration, then SAVE.
  4. Press Close: the show starts right away, full screen. No restart needed.

ON HALLOWEEN NIGHT
  - Open "Spooky Treat Station" from the menu (or ./start.sh). That's it.
  - Start it automatically when you log in:  ./autostart-on.sh   (off: ./autostart-off.sh)
  - To quit: press S -> Advanced -> Exit app (or Alt+F4, then close the terminal).

KEYBOARD (while the show is running)
  S  setup on/off   F  full screen   M  mute   D  small camera view
  1  invite scene   2-5 kids: welcome, take-one, BOO!, goodbye
  6-9 adults: welcome, take-one, SCARE!, goodbye   0  back to automatic

VOICES
  The characters talk with natural voices made on this PC (Piper, included).
  The first start prepares all sentences in the background (a few minutes on a
  slow PC; see Setup -> Sound & voice). Until then a sentence may only appear as
  a subtitle, because Chrome on Linux usually has no built-in voices. Optional
  fallback voices:  sudo apt install speech-dispatcher espeak-ng

YOUR OWN VIDEOS / SOUNDS
  Put .mp4 videos, pictures or .mp3 sounds into the folders inside "media"
  (e.g. media/scare-adults), then Setup -> "My media" -> "My media" or "Mix".

TIPS
  - Camera: people must be seen head to toe while walking up. Don't tilt it
    steeply down. Logitech C270: about 2 m high, 2-3 m behind the screen, tilted
    10-15 degrees down; keep Setup -> Camera picture on "Standard 4:3".
  - The program blocks system sleep while it runs (via systemd). If your screen
    still turns off, set "Blank screen" to Never in your system settings.
  - Turn on automatic login (Settings -> Users) so it starts after a power cut.
  - Ubuntu's Chromium (snap): if there's no camera picture, run
        sudo snap connect chromium:camera
    Google Chrome doesn't need this.
  - Remove the menu/desktop icons again:  ./install.sh --remove

FILES
  SpookyTreatStation   the program (starts a tiny local web server + opens Chrome)
  start.sh, setup-mode.sh, install.sh, autostart-on.sh, autostart-off.sh
  settings.json        your settings (created when you press Save) - back it up!
  media/               your own videos / pictures / sounds
  browser-profile/     private browser data for the show (safe to delete)
  piper/, voices/      the offline natural-voice engine and its voice
  voice-cache/         the generated sentences (safe to delete; they are made again)

TROUBLESHOOTING
  "needs Google Chrome"   -> run ./install.sh in a terminal (it can install Chrome).
  No camera picture       -> Setup -> Start here -> pick the camera; close other apps using it;
                             snap Chromium: sudo snap connect chromium:camera
  No sound                -> check the volume / output device in your system settings.
  Nobody detected         -> more light; lower "Detection confidence" (Setup -> Advanced).
  Kids shown as adults    -> redo the calibration (Setup -> Kids vs adults).
  Icons won't start       -> right-click the desktop icon -> "Allow Launching".

Full guide and source code: see README.md on the project's GitHub page.
