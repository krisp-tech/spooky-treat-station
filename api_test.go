package main

// Handler-level tests for the launcher API (net/http/httptest, no real server).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

func newTestApp(t *testing.T) *app {
	t.Helper()
	dir := t.TempDir()
	a := &app{baseDir: dir, settingsPath: filepath.Join(dir, "settings.json"), mediaDir: filepath.Join(dir, "media")}
	a.ensureMediaFolders()
	return a
}

func do(h http.HandlerFunc, method, target string, body []byte) *httptest.ResponseRecorder {
	var r *http.Request
	if body != nil {
		r = httptest.NewRequest(method, target, bytes.NewReader(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	w := httptest.NewRecorder()
	h(w, r)
	return w
}

// API-01
func TestSettingsGetWithoutFileReturnsEmptyObject(t *testing.T) {
	a := newTestApp(t)
	w := do(a.handleSettings, "GET", "/api/settings", nil)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "{}" {
		t.Fatalf("got %d %q", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("content-type %q", ct)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("cache-control %q", cc)
	}
}

// API-02
func TestSettingsRoundTrip(t *testing.T) {
	a := newTestApp(t)
	in := map[string]any{"zones": map[string]any{"nearLine": 0.66, "jar": map[string]any{"enabled": false}},
		"phrases": map[string]any{"idle": []any{"Hällo <b>&</b> \"quoted\" 🎃"}}}
	b, _ := json.Marshal(in)
	w := do(a.handleSettings, "POST", "/api/settings", b)
	if w.Code != 200 {
		t.Fatalf("POST %d %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["ok"] != true || resp["path"] != a.settingsPath {
		t.Fatalf("POST response %v", resp)
	}
	w = do(a.handleSettings, "GET", "/api/settings", nil)
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	ob, _ := json.Marshal(out)
	if string(ob) != string(b) {
		t.Fatalf("round trip changed settings:\n in  %s\n out %s", b, ob)
	}
	// stored pretty-printed, so people can back it up / read it
	raw, _ := os.ReadFile(a.settingsPath)
	if !strings.Contains(string(raw), "\n  \"") {
		t.Fatalf("settings.json is not indented: %s", raw)
	}
}

// API-03
func TestSettingsPutAlsoSaves(t *testing.T) {
	a := newTestApp(t)
	if w := do(a.handleSettings, "PUT", "/api/settings", []byte(`{"a":1}`)); w.Code != 200 {
		t.Fatalf("PUT %d", w.Code)
	}
}

// API-04
func TestSettingsInvalidJSONRejectedAndFileUnchanged(t *testing.T) {
	a := newTestApp(t)
	do(a.handleSettings, "POST", "/api/settings", []byte(`{"keep":true}`))
	before, _ := os.ReadFile(a.settingsPath)
	for _, body := range []string{``, `{`, `{"a":}`, `[1,2]`, `"str"`, `42`, `{"a":1}garbage`, "\xff\xfe"} {
		w := do(a.handleSettings, "POST", "/api/settings", []byte(body))
		if w.Code != http.StatusBadRequest {
			t.Errorf("body %q: got %d, want 400", body, w.Code)
		}
	}
	after, _ := os.ReadFile(a.settingsPath)
	if string(before) != string(after) {
		t.Fatalf("invalid POST changed settings.json")
	}
}

// API-05
func TestSettingsNullBodyRejected(t *testing.T) {
	// `null` is valid JSON but not a settings object; storing it makes the next start look like a first run.
	a := newTestApp(t)
	do(a.handleSettings, "POST", "/api/settings", []byte(`{"keep":true}`))
	w := do(a.handleSettings, "POST", "/api/settings", []byte(`null`))
	raw, _ := os.ReadFile(a.settingsPath)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("POST null: got %d, settings.json is now %q (want 400 and file unchanged)", w.Code, strings.TrimSpace(string(raw)))
	}
}

// API-06
func TestSettingsMethodNotAllowed(t *testing.T) {
	a := newTestApp(t)
	for _, m := range []string{"DELETE", "PATCH"} {
		if w := do(a.handleSettings, m, "/api/settings", nil); w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: %d", m, w.Code)
		}
	}
}

// API-07
func TestSettingsAtomicWriteNoTempLeftAndConcurrentWritesStayValid(t *testing.T) {
	a := newTestApp(t)
	var wg sync.WaitGroup
	bodies := map[string]bool{}
	var mu sync.Mutex
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			b := []byte(fmt.Sprintf(`{"writer":%d,"pad":"%s"}`, i, strings.Repeat("x", 20000+i)))
			mu.Lock()
			bodies[fmt.Sprint(i)] = true
			mu.Unlock()
			if w := do(a.handleSettings, "POST", "/api/settings", b); w.Code != 200 {
				t.Errorf("POST %d: %d", i, w.Code)
			}
			// a reader in parallel must never see a half-written file
			w := do(a.handleSettings, "GET", "/api/settings", nil)
			var v map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
				t.Errorf("GET during writes returned invalid JSON: %v", err)
			}
		}(i)
	}
	wg.Wait()
	raw, _ := os.ReadFile(a.settingsPath)
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("final file invalid: %v", err)
	}
	if !bodies[fmt.Sprint(v["writer"])] {
		t.Fatalf("unexpected writer %v", v["writer"])
	}
	if _, err := os.Stat(a.settingsPath + ".tmp"); !os.IsNotExist(err) {
		t.Fatalf("temp file left behind")
	}
}

// API-08
func TestSettingsWriteFailureReports500AndKeepsOldFile(t *testing.T) {
	a := newTestApp(t)
	do(a.handleSettings, "POST", "/api/settings", []byte(`{"keep":true}`))
	// make the temp path a non-empty directory so the write fails (works as root too, unlike chmod)
	if err := os.MkdirAll(filepath.Join(a.settingsPath+".tmp", "x"), 0o755); err != nil {
		t.Fatal(err)
	}
	w := do(a.handleSettings, "POST", "/api/settings", []byte(`{"new":true}`))
	if w.Code != 500 {
		t.Fatalf("got %d", w.Code)
	}
	raw, _ := os.ReadFile(a.settingsPath)
	if !strings.Contains(string(raw), "keep") {
		t.Fatalf("old settings lost: %s", raw)
	}
}

// API-09
func TestSettingsCorruptFileOnDisk(t *testing.T) {
	// The launcher passes the bytes through; the web app must cope (tested in test/browser/boot.mjs).
	a := newTestApp(t)
	_ = os.WriteFile(a.settingsPath, []byte("{this is not json"), 0o644)
	w := do(a.handleSettings, "GET", "/api/settings", nil)
	if w.Code != 200 && w.Code != 500 {
		t.Fatalf("unexpected %d", w.Code)
	}
	// saving again repairs it
	if w := do(a.handleSettings, "POST", "/api/settings", []byte(`{"ok":1}`)); w.Code != 200 {
		t.Fatalf("repair POST %d", w.Code)
	}
}

// API-10
func TestSettingsBodyLimit(t *testing.T) {
	a := newTestApp(t)
	big := func(n int) []byte { return []byte(`{"phrases":{"idle":["` + strings.Repeat("a", n) + `"]}}`) }
	if w := do(a.handleSettings, "POST", "/api/settings", big(3<<20)); w.Code != 200 {
		t.Fatalf("3 MiB settings rejected: %d", w.Code)
	}
	w := do(a.handleSettings, "POST", "/api/settings", big(5<<20))
	if w.Code < 400 || w.Code > 499 {
		t.Fatalf("5 MiB body: %d", w.Code)
	}
	msg := strings.TrimSpace(w.Body.String())
	if len(msg) > 40 {
		msg = msg[:40]
	}
	t.Logf("5 MiB body -> %d %s", w.Code, msg)
}

// ---------------------------------------------------------------- media folders + listing

// API-11
func TestEnsureMediaFoldersCreatesAllFoldersWithReadme(t *testing.T) {
	a := newTestApp(t)
	for _, f := range mediaFolders {
		b, err := os.ReadFile(filepath.Join(a.mediaDir, f, "README.txt"))
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		if !strings.Contains(string(b), f) {
			t.Errorf("README for %s does not name the stage", f)
		}
	}
	if len(mediaFolders) != 9 {
		t.Fatalf("expected 9 media folders, got %d", len(mediaFolders))
	}
}

// API-12
func TestEnsureMediaFoldersKeepsUserReadmeAndFiles(t *testing.T) {
	a := newTestApp(t)
	p := filepath.Join(a.mediaDir, "idle", "README.txt")
	_ = os.WriteFile(p, []byte("my notes"), 0o644)
	_ = os.WriteFile(filepath.Join(a.mediaDir, "idle", "a.mp4"), []byte("x"), 0o644)
	a.ensureMediaFolders()
	if b, _ := os.ReadFile(p); string(b) != "my notes" {
		t.Fatal("README overwritten")
	}
	if _, err := os.Stat(filepath.Join(a.mediaDir, "idle", "a.mp4")); err != nil {
		t.Fatal("user file removed")
	}
}

// API-13
func TestEnsureMediaFoldersSurvivesMediaPathBeingAFile(t *testing.T) {
	dir := t.TempDir()
	a := &app{baseDir: dir, settingsPath: filepath.Join(dir, "settings.json"), mediaDir: filepath.Join(dir, "media")}
	_ = os.WriteFile(a.mediaDir, []byte("oops"), 0o644)
	a.ensureMediaFolders() // must not panic / exit
	w := do(a.handleMediaList, "GET", "/api/media", nil)
	if w.Code != 200 {
		t.Fatalf("media list %d", w.Code)
	}
}

// API-14
func TestMediaReadmeNamesTheRealSetupTab(t *testing.T) {
	// The setup tab is called "My media" (setup.js / README.md); the folder README must not send people to "Content".
	txt := mediaReadme("idle")
	if strings.Contains(txt, `go to "Content"`) || !strings.Contains(txt, `"My media" tab`) && !strings.Contains(txt, `go to "My media"`) {
		t.Fatalf("media README points to a tab that does not exist:\n%s", txt)
	}
}

func listMedia(t *testing.T, a *app) map[string][]string {
	t.Helper()
	w := do(a.handleMediaList, "GET", "/api/media", nil)
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	out := map[string][]string{}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// API-15
func TestMediaListEmptyFoldersAllPresent(t *testing.T) {
	a := newTestApp(t)
	out := listMedia(t, a)
	for _, f := range mediaFolders {
		v, ok := out[f]
		if !ok || v == nil || len(v) != 0 {
			t.Errorf("%s: %v (present=%v)", f, v, ok)
		}
	}
	_ = os.RemoveAll(a.mediaDir) // media folder deleted while running
	out = listMedia(t, a)
	if len(out) != len(mediaFolders) {
		t.Fatalf("got %d folders", len(out))
	}
}

// oddNames are file names users really produce (phones, downloads). The listed URL must decode back to the name.
func oddNames() []string {
	names := []string{
		"plain.mp4", "with space.mp4", "hash#1.webm", "100% scary.mp4", "what?.jpg", "a&b+c=d.png", "semi;colon.gif",
		"ünïcødé ghost 🎃.mp4", "日本語.webm", "comma,(paren)[br]{cu}.mp3", "it's.wav", "tilde~excl!dollar$at@.ogg",
		"UPPER.MP4", "multi.dots.name.m4a", "%41%2F.webp", "dots..in..middle.jpg", "-dash.jpeg", "trailing.mov ", "x.m4v", "y.ogv",
	}
	if runtime.GOOS != "windows" {
		names = append(names, `quote".mp4`, "less<more>.png", "pipe|star*.jpg")
	}
	return names
}

// API-16
func TestMediaListOddFilenamesEscapedCorrectly(t *testing.T) {
	a := newTestApp(t)
	dir := filepath.Join(a.mediaDir, "scare-adults")
	want := []string{}
	for _, n := range oddNames() {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644); err != nil {
			t.Logf("skip %q: %v", n, err)
			continue
		}
		if strings.HasSuffix(n, " ") { // ".mov " has no media extension: must be ignored
			continue
		}
		want = append(want, n)
	}
	got := listMedia(t, a)["scare-adults"]
	decoded := []string{}
	for _, u := range got {
		pu, err := url.Parse(u)
		if err != nil {
			t.Errorf("listed URL %q does not parse: %v", u, err)
			continue
		}
		if pu.RawQuery != "" || pu.Fragment != "" {
			t.Errorf("listed URL %q has a query/fragment part (unescaped ? or #)", u)
		}
		if !strings.HasPrefix(pu.Path, "/media/scare-adults/") {
			t.Errorf("bad prefix %q", pu.Path)
			continue
		}
		decoded = append(decoded, strings.TrimPrefix(pu.Path, "/media/scare-adults/"))
	}
	sort.Strings(want)
	sort.Strings(decoded)
	if strings.Join(want, "\n") != strings.Join(decoded, "\n") {
		t.Fatalf("decoded names differ:\nwant %q\ngot  %q", want, decoded)
	}
	if !sort.StringsAreSorted(got) {
		t.Errorf("listing not sorted")
	}
}

// API-17
func TestMediaListIgnoresUnsupportedHiddenAndDirs(t *testing.T) {
	a := newTestApp(t)
	dir := filepath.Join(a.mediaDir, "idle")
	for _, n := range []string{"notes.txt", "doc.pdf", "movie.avi", "movie.mkv", "Thumbs.db", "desktop.ini", ".hidden.mp4", "noext", "a.mp4.part", "ok.mp4"} {
		_ = os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644)
	}
	_ = os.MkdirAll(filepath.Join(dir, "sub.mp4"), 0o755)
	got := listMedia(t, a)["idle"]
	if len(got) != 1 || got[0] != "/media/idle/ok.mp4" {
		t.Fatalf("got %v", got)
	}
}

// API-18
func TestUrlPathEscapeRoundTrip(t *testing.T) {
	for _, n := range oddNames() {
		u, err := url.Parse("/media/x/" + urlPathEscape(n))
		if err != nil {
			t.Errorf("%q: %v", n, err)
			continue
		}
		if u.Path != "/media/x/"+n {
			t.Errorf("%q decoded as %q", n, u.Path)
		}
	}
}

// ---------------------------------------------------------------- live updates (v1.0.3)

// API-20: /api/state reports a new settingsRev after every save, and the save response carries it
func TestStateSettingsRevChangesOnSave(t *testing.T) {
	a := newTestApp(t)
	var st0 map[string]any
	_ = json.Unmarshal(do(a.handleState, "GET", "/api/state", nil).Body.Bytes(), &st0)
	if st0["settingsRev"] != "" {
		t.Fatalf("rev before any save: %v", st0["settingsRev"])
	}
	w := do(a.handleSettings, "POST", "/api/settings", []byte(`{"a":1}`))
	var saved map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &saved)
	var st1 map[string]any
	_ = json.Unmarshal(do(a.handleState, "GET", "/api/state", nil).Body.Bytes(), &st1)
	if st1["settingsRev"] == "" || st1["settingsRev"] != saved["rev"] {
		t.Fatalf("rev after save: state=%v response=%v", st1["settingsRev"], saved["rev"])
	}
	time.Sleep(10 * time.Millisecond)
	do(a.handleSettings, "POST", "/api/settings", []byte(`{"a":22}`))
	var st2 map[string]any
	_ = json.Unmarshal(do(a.handleState, "GET", "/api/state", nil).Body.Bytes(), &st2)
	if st2["settingsRev"] == st1["settingsRev"] {
		t.Fatal("rev did not change after a second save")
	}
}

// API-21: mediaRev changes when a media file is added; pageActive follows polling
func TestStateMediaRevAndPageActive(t *testing.T) {
	a := newTestApp(t)
	if a.pageActive() {
		t.Fatal("page active before any poll")
	}
	var st0, st1 map[string]any
	_ = json.Unmarshal(do(a.handleState, "GET", "/api/state", nil).Body.Bytes(), &st0)
	if !a.pageActive() {
		t.Fatal("page not active right after polling")
	}
	_ = os.WriteFile(filepath.Join(a.mediaDir, "idle", "x.mp4"), []byte("x"), 0o644)
	_ = json.Unmarshal(do(a.handleState, "GET", "/api/state", nil).Body.Bytes(), &st1)
	if st0["mediaRev"] == st1["mediaRev"] {
		t.Fatal("mediaRev unchanged after adding a file")
	}
}

// API-22: open-setup is POST only and bumps the counter seen by /api/state
func TestOpenSetupSignal(t *testing.T) {
	a := newTestApp(t)
	if w := do(a.handleOpenSetup, "GET", "/api/open-setup", nil); w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET open-setup: %d", w.Code)
	}
	do(a.handleOpenSetup, "POST", "/api/open-setup", nil)
	var st map[string]any
	_ = json.Unmarshal(do(a.handleState, "GET", "/api/state", nil).Body.Bytes(), &st)
	if st["openSetup"] != float64(1) {
		t.Fatalf("openSetup = %v", st["openSetup"])
	}
}
