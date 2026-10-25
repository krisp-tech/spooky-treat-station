package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestAllowCameraKeepsExistingPrefs(t *testing.T) {
	dir := t.TempDir()
	if d := os.Getenv("SEED_DIR"); d != "" { // used by the browser check in test/
		dir = d
	}
	path := filepath.Join(dir, "Default", "Preferences")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		_ = os.WriteFile(path, []byte(`{"browser":{"has_seen_welcome_page":true}}`), 0o644)
	}
	for i := 0; i < 2; i++ { // second call must be a no-op
		if err := allowCamera(dir, "http://127.0.0.1:8765"); err != nil {
			t.Fatal(err)
		}
	}
	b, _ := os.ReadFile(path)
	var p map[string]any
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	if p["browser"] == nil {
		t.Fatal("existing prefs were lost")
	}
	cam := p["profile"].(map[string]any)["content_settings"].(map[string]any)["exceptions"].(map[string]any)["media_stream_camera"].(map[string]any)
	if cam["http://127.0.0.1:8765,*"].(map[string]any)["setting"] != float64(1) {
		t.Fatalf("camera not allowed: %v", cam)
	}
}

func TestAllowCameraLeavesBrokenFileAlone(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "Default", "Preferences")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte("{not json"), 0o644)
	if err := allowCamera(dir, "http://127.0.0.1:8765"); err == nil {
		t.Fatal("expected an error for an unreadable file")
	}
	if b, _ := os.ReadFile(path); string(b) != "{not json" {
		t.Fatal("broken file was overwritten")
	}
}

// LX-01: on Linux, Google Chrome is preferred over Chromium (Ubuntu's snap Chromium is more restricted)
func TestFindBrowserLinuxPrefersChromeOverChromium(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux only")
	}
	dir := t.TempDir()
	for _, n := range []string{"chromium", "google-chrome-stable"} {
		_ = os.WriteFile(filepath.Join(dir, n), []byte("#!/bin/sh\n"), 0o755)
	}
	t.Setenv("PATH", dir)
	if p, isEdge := findBrowser(); p != filepath.Join(dir, "google-chrome-stable") || isEdge {
		t.Fatalf("got %q edge=%v", p, isEdge)
	}
}

// LX-02: with no browser, Linux users get the exact commands to install Google Chrome
func TestOpenBrowserLinuxMissingExplainsChromeInstall(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("linux only")
	}
	t.Setenv("PATH", t.TempDir())
	if _, err := os.Stat("/snap/bin/chromium"); err == nil {
		t.Skip("snap chromium installed on this machine")
	}
	err := openBrowser("", "http://127.0.0.1:1/", t.TempDir(), true)
	if err == nil || !strings.Contains(err.Error(), "sudo apt install ./google-chrome-stable_current_amd64.deb") || !strings.Contains(err.Error(), "install.sh") {
		t.Fatalf("err = %v", err)
	}
}
