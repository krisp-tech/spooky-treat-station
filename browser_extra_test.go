package main

// More tests for allowCamera / openBrowser / findBrowser (browser.go).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func readPrefs(t *testing.T, dir string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(dir, "Default", "Preferences"))
	if err != nil {
		t.Fatal(err)
	}
	var p map[string]any
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func cameraExceptions(t *testing.T, p map[string]any) map[string]any {
	t.Helper()
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("camera exceptions missing: %v", r)
		}
	}()
	return p["profile"].(map[string]any)["content_settings"].(map[string]any)["exceptions"].(map[string]any)["media_stream_camera"].(map[string]any)
}

// CAM-01
func TestAllowCameraCreatesProfileFromScratch(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "new-profile")
	if err := allowCamera(dir, "http://127.0.0.1:8765"); err != nil {
		t.Fatal(err)
	}
	cam := cameraExceptions(t, readPrefs(t, dir))
	e := cam["http://127.0.0.1:8765,*"].(map[string]any)
	if e["setting"] != float64(1) {
		t.Fatalf("setting %v", e["setting"])
	}
	// last_modified: microseconds since 1601-01-01, as a string, close to now
	us, err := strconv.ParseInt(e["last_modified"].(string), 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UnixMicro() + 11644473600000000
	if d := now - us; d < 0 || d > 60e6 {
		t.Fatalf("last_modified off by %d µs", d)
	}
}

// CAM-02
func TestAllowCameraMergesWithOtherExceptionsAndSettings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Default", "Preferences")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	seed := `{"browser":{"window_placement":{"left":10}},"profile":{"name":"Kiosk","content_settings":{"exceptions":{
	  "media_stream_camera":{"https://other.example:443,*":{"setting":2,"last_modified":"1"}},
	  "media_stream_mic":{"http://127.0.0.1:8765,*":{"setting":1}}}}},"big":12345678901234}`
	_ = os.WriteFile(path, []byte(seed), 0o644)
	if err := allowCamera(dir, "http://127.0.0.1:8765"); err != nil {
		t.Fatal(err)
	}
	p := readPrefs(t, dir)
	if p["browser"] == nil || p["profile"].(map[string]any)["name"] != "Kiosk" {
		t.Fatal("unrelated preferences lost")
	}
	cam := cameraExceptions(t, p)
	if cam["https://other.example:443,*"] == nil {
		t.Fatal("other site's camera exception lost")
	}
	if cam["http://127.0.0.1:8765,*"].(map[string]any)["setting"] != float64(1) {
		t.Fatal("not allowed")
	}
	ex := p["profile"].(map[string]any)["content_settings"].(map[string]any)["exceptions"].(map[string]any)
	if ex["media_stream_mic"] == nil {
		t.Fatal("mic exceptions lost")
	}
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), "12345678901234") {
		t.Errorf("large integer changed while rewriting Preferences: %s", raw)
	}
}

// CAM-03
func TestAllowCameraIdempotentDoesNotRewriteFile(t *testing.T) {
	dir := t.TempDir()
	if err := allowCamera(dir, "http://127.0.0.1:8765"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "Default", "Preferences")
	before, _ := os.ReadFile(path)
	st1, _ := os.Stat(path)
	time.Sleep(20 * time.Millisecond)
	if err := allowCamera(dir, "http://127.0.0.1:8765"); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	st2, _ := os.Stat(path)
	if string(before) != string(after) || !st1.ModTime().Equal(st2.ModTime()) {
		t.Fatal("second call rewrote the file")
	}
}

// CAM-04
func TestAllowCameraOverridesBlockAndAddsNewPort(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Default", "Preferences")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte(`{"profile":{"content_settings":{"exceptions":{"media_stream_camera":{"http://127.0.0.1:8765,*":{"setting":2}}}}}}`), 0o644)
	if err := allowCamera(dir, "http://127.0.0.1:8765"); err != nil {
		t.Fatal(err)
	}
	if err := allowCamera(dir, "http://127.0.0.1:8766"); err != nil {
		t.Fatal(err)
	}
	cam := cameraExceptions(t, readPrefs(t, dir))
	for _, k := range []string{"http://127.0.0.1:8765,*", "http://127.0.0.1:8766,*"} {
		if cam[k].(map[string]any)["setting"] != float64(1) {
			t.Errorf("%s not allowed: %v", k, cam[k])
		}
	}
}

// CAM-05
func TestAllowCameraLeavesNonObjectAndEmptyFilesAlone(t *testing.T) {
	for _, content := range []string{"[]", "null", "\"x\"", "", "{\"profile\":", "{\"profile\":null}", "{\"profile\":{\"content_settings\":7}}"} {
		dir := t.TempDir()
		path := filepath.Join(dir, "Default", "Preferences")
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		_ = os.WriteFile(path, []byte(content), 0o644)
		var err error
		panicked := func() (p any) {
			defer func() { p = recover() }()
			err = allowCamera(dir, "http://127.0.0.1:8765")
			return nil
		}()
		if panicked != nil {
			t.Errorf("Preferences content %q: allowCamera PANICS (%v) - this would crash the launcher at start", content, panicked)
			continue
		}
		b, _ := os.ReadFile(path)
		if err != nil && string(b) != content {
			t.Errorf("content %q: changed although an error was returned", content)
		}
		if err == nil && strings.HasPrefix(content, "{") {
			if cameraExceptions(t, readPrefs(t, dir))["http://127.0.0.1:8765,*"] == nil {
				t.Errorf("content %q: no error but camera not allowed", content)
			}
		} else if err == nil && string(b) != content {
			t.Errorf("content %q: not an object, but overwritten without error -> %s", content, b)
		}
	}
}

// CAM-06
func TestAllowCameraPreferencesIsADirectory(t *testing.T) {
	dir := t.TempDir()
	_ = os.MkdirAll(filepath.Join(dir, "Default", "Preferences"), 0o755)
	if err := allowCamera(dir, "http://127.0.0.1:8765"); err == nil {
		t.Fatal("expected an error")
	}
}

// fakeBrowser writes a script that records its arguments, one per line.
func fakeBrowser(t *testing.T, name string) (path, argsFile string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake browser")
	}
	dir := t.TempDir()
	path = filepath.Join(dir, name)
	argsFile = filepath.Join(dir, "args.txt")
	script := "#!/bin/sh\nfor a in \"$@\"; do echo \"$a\"; done > " + argsFile + "\n"
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return path, argsFile
}

func waitArgs(t *testing.T, f string) []string {
	t.Helper()
	for i := 0; i < 100; i++ {
		if b, err := os.ReadFile(f); err == nil && len(b) > 0 {
			return strings.Split(strings.TrimSpace(string(b)), "\n")
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("fake browser was not started")
	return nil
}

func has(args []string, a string) bool {
	for _, x := range args {
		if x == a {
			return true
		}
	}
	return false
}

// BR-01
func TestOpenBrowserKioskArgsChrome(t *testing.T) {
	path, af := fakeBrowser(t, "google-chrome")
	profile := filepath.Join(t.TempDir(), "browser-profile")
	if err := openBrowser(path, "http://127.0.0.1:8765/", profile, true); err != nil {
		t.Fatal(err)
	}
	args := waitArgs(t, af)
	for _, want := range []string{"--user-data-dir=" + profile, "--kiosk", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "--disable-background-timer-throttling"} {
		if !has(args, want) {
			t.Errorf("missing %s in %v", want, args)
		}
	}
	if has(args, "--edge-kiosk-type=fullscreen") {
		t.Error("InPrivate Edge kiosk type passed")
	}
	if args[len(args)-1] != "http://127.0.0.1:8765/" {
		t.Errorf("URL must be the last argument: %v", args)
	}
	cam := cameraExceptions(t, readPrefs(t, profile))
	if cam["http://127.0.0.1:8765,*"] == nil {
		t.Fatal("camera not pre-allowed for the app origin")
	}
}

// BR-02
func TestOpenBrowserKioskArgsEdge(t *testing.T) {
	path, af := fakeBrowser(t, "msedge")
	if err := openBrowser(path, "http://127.0.0.1:8765/", t.TempDir(), true); err != nil {
		t.Fatal(err)
	}
	args := waitArgs(t, af)
	if !has(args, "--kiosk") {
		t.Fatalf("--kiosk missing: %v", args)
	}
	// Edge's own kiosk type is InPrivate, which ignores the pre-allowed camera and shows a prompt.
	if has(args, "--edge-kiosk-type=fullscreen") {
		t.Fatalf("InPrivate Edge kiosk type passed: %v", args)
	}
}

// BR-03
func TestOpenBrowserWindowedSetupArgs(t *testing.T) {
	path, af := fakeBrowser(t, "chromium")
	if err := openBrowser(path, "http://127.0.0.1:8765/?setup=1", t.TempDir(), false); err != nil {
		t.Fatal(err)
	}
	args := waitArgs(t, af)
	if has(args, "--kiosk") || !has(args, "--app=http://127.0.0.1:8765/?setup=1") || !has(args, "--window-size=1400,900") {
		t.Fatalf("windowed args wrong: %v", args)
	}
}

// BR-04
func TestOpenBrowserMissingExecutable(t *testing.T) {
	err := openBrowser(filepath.Join(t.TempDir(), "no-such-browser"), "http://127.0.0.1:8765/", t.TempDir(), true)
	if err == nil {
		t.Fatal("expected an error for a missing browser")
	}
}

// BR-05
func TestFindBrowserPrefersEdgeOnPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("PATH-based lookup is the linux branch")
	}
	dir := t.TempDir()
	for _, n := range []string{"microsoft-edge", "google-chrome"} {
		_ = os.WriteFile(filepath.Join(dir, n), []byte("#!/bin/sh\n"), 0o755)
	}
	t.Setenv("PATH", dir)
	p, isEdge := findBrowser()
	if p != filepath.Join(dir, "microsoft-edge") || !isEdge {
		t.Fatalf("got %q edge=%v", p, isEdge)
	}
}
