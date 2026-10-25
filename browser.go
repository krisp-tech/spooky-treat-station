package main

import (
	"encoding/json"
	"errors"
	"fmt"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func findBrowser() (path string, isEdge bool) {
	var candidates []string
	switch runtime.GOOS {
	case "windows":
		pf := os.Getenv("ProgramFiles")
		pf86 := os.Getenv("ProgramFiles(x86)")
		local := os.Getenv("LOCALAPPDATA")
		candidates = []string{
			filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
			filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
			filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
			filepath.Join(local, `Google\Chrome\Application\chrome.exe`),
		}
	case "darwin":
		candidates = []string{
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		}
	default:
		// Linux: Edge, then Chrome, then Chromium (Ubuntu's snap Chromium last - it works, but is more restricted)
		for _, n := range []string{"microsoft-edge", "microsoft-edge-stable", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"} {
			if p, err := exec.LookPath(n); err == nil {
				candidates = append(candidates, p)
			}
		}
		candidates = append(candidates, "/snap/bin/chromium")
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, strings.Contains(strings.ToLower(c), "edge")
		}
	}
	return "", false
}

// allowCamera writes a camera "Allow" exception for origin into the private browser profile,
// exactly what Edge/Chrome store when you click "Allow" on the camera prompt yourself.
// Existing preferences are kept; a file we can't parse is left untouched.
func allowCamera(profileDir, origin string) error {
	path := filepath.Join(profileDir, "Default", "Preferences")
	prefs := map[string]any{}
	if b, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(b, &prefs); err != nil {
			return fmt.Errorf("unreadable %s: %w", path, err)
		}
		if prefs == nil { // file contained `null`: not ours to fix, leave it alone
			return fmt.Errorf("unexpected content in %s", path)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	child := func(m map[string]any, key string) map[string]any {
		c, ok := m[key].(map[string]any)
		if !ok {
			c = map[string]any{}
			m[key] = c
		}
		return c
	}
	camera := child(child(child(child(prefs, "profile"), "content_settings"), "exceptions"), "media_stream_camera")
	key := origin + ",*"
	if e, ok := camera[key].(map[string]any); ok && e["setting"] == float64(1) {
		return nil // already allowed
	}
	// Chromium timestamps: microseconds since 1601-01-01
	camera[key] = map[string]any{
		"setting":       1,
		"last_modified": fmt.Sprint(time.Now().UnixMicro() + 11644473600000000),
	}
	b, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

func browserMissingHelp() string {
	if runtime.GOOS == "linux" {
		return "Google Chrome, Chromium or Microsoft Edge is needed but was not found.\n" +
			"  Install Google Chrome (Ubuntu / Mint / Debian, 64-bit PC):\n" +
			"    wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb\n" +
			"    sudo apt install ./google-chrome-stable_current_amd64.deb\n" +
			"  Or run ./install.sh in this folder, which can do it for you."
	}
	return "Microsoft Edge or Google Chrome was not found"
}

// openBrowser starts Edge/Chrome with a dedicated profile so our kiosk flags always apply
// (flags are ignored if the browser is already running with the same profile).
func openBrowser(custom, url, profileDir string, kiosk bool) error {
	path, isEdge := custom, strings.Contains(strings.ToLower(custom), "edge")
	if path == "" {
		path, isEdge = findBrowser()
	}
	if path == "" {
		return errors.New(browserMissingHelp())
	}
	_ = os.MkdirAll(profileDir, 0o755)
	// Pre-allow the camera for our page only (no warning-producing test flags needed).
	if u, err := neturl.Parse(url); err == nil {
		if err := allowCamera(profileDir, u.Scheme+"://"+u.Host); err != nil {
			fmt.Println("Note: could not pre-allow the camera (you may be asked once):", err)
		}
	}
	args := []string{
		"--user-data-dir=" + profileDir,
		"--no-first-run",
		"--no-default-browser-check",
		// Sound and the talking voice start without anyone clicking first.
		"--autoplay-policy=no-user-gesture-required",
		"--disable-features=Translate,TranslateUI,msEdgeTranslate",
		"--disable-session-crashed-bubble",
		"--hide-crash-restore-bubble",
		"--noerrdialogs",
		"--disable-pinch",
		"--overscroll-history-navigation=0",
		"--disable-background-timer-throttling",
		"--disable-renderer-backgrounding",
		"--disable-backgrounding-occluded-windows",
	}
	if kiosk {
		args = append(args, "--kiosk")
		if isEdge {
			args = append(args, "--edge-kiosk-type=fullscreen")
		}
		args = append(args, url)
	} else {
		args = append(args, "--new-window", "--app="+url, "--window-size=1400,900")
	}
	cmd := exec.Command(path, args...)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("starting %s: %w", path, err)
	}
	fmt.Println("Browser     :", path)
	go func() { _ = cmd.Wait() }()
	return nil
}
