// Spooky Treat Station launcher.
//
// A single self-contained executable that:
//   - serves the web app (embedded into the binary) on http://127.0.0.1:<port>
//   - stores settings in settings.json next to the executable
//   - serves your own videos/images/sounds from the media/ folder next to the executable
//   - opens Microsoft Edge (or Chrome) full screen in kiosk mode
//   - keeps the computer and screen from going to sleep while it runs
//
// Everything runs locally. No internet connection is needed.
package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"io"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed all:web
var webFS embed.FS

var version = "dev"

// Media folders users can drop their own content into.
var mediaFolders = []string{
	"idle",
	"approach-kids", "approach-adults",
	"near-kids", "near-adults",
	"scare-kids", "scare-adults",
	"goodbye-kids", "goodbye-adults",
}

var mediaExts = map[string]bool{
	".mp4": true, ".webm": true, ".ogv": true, ".mov": true, ".m4v": true,
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
	".mp3": true, ".wav": true, ".ogg": true, ".m4a": true,
}

type app struct {
	baseDir      string
	settingsPath string
	mediaDir     string
	mu           sync.Mutex
	lastPoll     atomic.Int64 // when a show page last checked in (unix nanoseconds)
	openSetupSeq atomic.Int64 // bumped to ask the open show page to show its setup screen
}

func main() {
	port := flag.Int("port", 8765, "local port for the web app")
	setup := flag.Bool("setup", false, "open directly in setup mode (windowed, not kiosk)")
	noBrowser := flag.Bool("no-browser", false, "only start the server, do not open a browser")
	windowed := flag.Bool("windowed", false, "open the browser in a normal window instead of kiosk/full screen")
	browserPath := flag.String("browser", "", "path to the browser executable (default: auto-detect Edge, then Chrome)")
	dataDir := flag.String("data", "", "folder for settings.json and media/ (default: next to the executable)")
	piperFlag := flag.String("piper", "", "path to the Piper program for natural voices (default: piper/ next to the executable)")
	voicesFlag := flag.String("voices", "", "folder with Piper voice models (default: voices/ next to the executable)")
	flag.Parse()

	exe, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	exe, _ = filepath.EvalSymlinks(exe)
	progDir := filepath.Dir(exe)
	// When run with "go run", the executable lives in a temp dir; use the working directory instead.
	if strings.Contains(progDir, "go-build") {
		progDir, _ = os.Getwd()
	}
	base := *dataDir
	if base == "" {
		base = progDir
	}
	piperExe, voicesDir := *piperFlag, *voicesFlag
	if piperExe == "" {
		piperExe = defaultPiperExe(progDir)
	}
	if voicesDir == "" {
		voicesDir = filepath.Join(progDir, "voices")
	}
	tts := newTTS(piperExe, voicesDir, filepath.Join(base, "voice-cache"))

	a := &app{
		baseDir:      base,
		settingsPath: filepath.Join(base, "settings.json"),
		mediaDir:     filepath.Join(base, "media"),
	}
	a.ensureMediaFolders()

	fmt.Println("==============================================")
	fmt.Println("  SPOOKY TREAT STATION", version)
	fmt.Println("==============================================")
	fmt.Println("Data folder :", base)
	fmt.Println("Media folder:", a.mediaDir)
	if ok, reason, voices := tts.status(); ok {
		fmt.Printf("Voices      : natural (Piper, %d voice model(s))\n", len(voices))
	} else {
		fmt.Println("Voices      : basic system voices (" + reason + ")")
	}

	// Set types explicitly: on Windows Go reads them from the registry, which is sometimes wrong (.js as text/plain).
	_ = mime.AddExtensionType(".js", "text/javascript")
	_ = mime.AddExtensionType(".mjs", "text/javascript")
	_ = mime.AddExtensionType(".cjs", "text/javascript")
	_ = mime.AddExtensionType(".css", "text/css; charset=utf-8")
	_ = mime.AddExtensionType(".html", "text/html; charset=utf-8")
	_ = mime.AddExtensionType(".json", "application/json")
	_ = mime.AddExtensionType(".mp4", "video/mp4")
	_ = mime.AddExtensionType(".webm", "video/webm")
	_ = mime.AddExtensionType(".mp3", "audio/mpeg")
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".task", "application/octet-stream")
	_ = mime.AddExtensionType(".tflite", "application/octet-stream")
	_ = mime.AddExtensionType(".woff2", "font/woff2")

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/settings", a.handleSettings)
	mux.HandleFunc("/api/media", a.handleMediaList)
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"version": version, "dataDir": base, "mediaDir": a.mediaDir, "pageActive": a.pageActive()})
	})
	mux.HandleFunc("/api/state", a.handleState)
	mux.HandleFunc("/api/open-setup", a.handleOpenSetup)
	mux.HandleFunc("/api/tts/status", tts.handleStatus)
	mux.HandleFunc("/api/tts", tts.handleSynth)
	mux.HandleFunc("/api/quit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
		go func() {
			time.Sleep(300 * time.Millisecond)
			fmt.Println("Quit requested from the app. Bye!")
			tts.stopAll()
			os.Exit(0)
		}()
	})
	mux.Handle("/media/", http.StripPrefix("/media/", noListing(http.FileServer(http.Dir(a.mediaDir)))))
	mux.Handle("/", noCache(noListing(http.FileServer(http.FS(sub)))))

	// The default port is tried first; if another program holds it, the next few are tried, so
	// a busy port never stops the show. An explicit -port is used as given.
	portChosen := false
	flag.Visit(func(f *flag.Flag) { portChosen = portChosen || f.Name == "port" })
	tries := 11
	if portChosen {
		tries = 1
	}
	var ln net.Listener
	var addr, url string
	for i := 0; i < tries; i++ {
		addr = fmt.Sprintf("127.0.0.1:%d", *port+i)
		url = "http://" + addr + "/"
		if *setup {
			url += "?setup=1"
		}
		var err error
		if ln, err = net.Listen("tcp", addr); err == nil {
			*port += i
			break
		}
		// Already running? Then use that one instead of failing (and don't start a second show).
		client := http.Client{Timeout: 2 * time.Second}
		if ok, active := isOurServer(&client, "http://"+addr+"/api/info"); ok {
			switch {
			case active && *setup:
				fmt.Println("Spooky Treat Station is already showing - opening its setup screen on the show.")
				if resp, err := client.Post("http://"+addr+"/api/open-setup", "application/json", nil); err == nil {
					resp.Body.Close()
				}
			case active:
				fmt.Println("Spooky Treat Station is already running and showing. Press S on the show for setup.")
			case !*noBrowser:
				fmt.Println("Spooky Treat Station is already running - opening it.")
				_ = openBrowser(*browserPath, url, filepath.Join(base, "browser-profile"), !(*windowed || *setup))
			default:
				fmt.Println("Spooky Treat Station is already running at", url)
			}
			time.Sleep(3 * time.Second)
			return
		}
		fmt.Printf("Port %d is used by another program.\n", *port+i)
		if i == tries-1 {
			fmt.Printf("\nCould not start on %s: %v\n", addr, err)
			fmt.Printf("Another program is using this port. Start with a different one, e.g.:  SpookyTreatStation.exe -port %d\n", *port+tries)
			waitForEnter()
			os.Exit(1)
		}
	}
	fmt.Println("App address :", url)

	preventSleep()

	go func() {
		if err := http.Serve(ln, localOnly(*port, mux)); err != nil {
			log.Fatal(err)
		}
	}()

	if *noBrowser {
		fmt.Println("\nServer running. Open the address above in Edge or Chrome. Press Ctrl+C to stop.")
		select {}
	}

	fmt.Println("\nOpening the browser... (keyboard: S = setup, F = full screen, M = mute, Esc = close setup)")
	fmt.Println("Close this window to stop Spooky Treat Station.")
	if err := openBrowser(*browserPath, url, filepath.Join(base, "browser-profile"), !(*windowed || *setup)); err != nil {
		fmt.Println("\nCould not open a browser automatically:", err)
		fmt.Println("Please open this address in Microsoft Edge or Google Chrome:", url)
	}
	select {}
}

func (a *app) ensureMediaFolders() {
	for _, f := range mediaFolders {
		dir := filepath.Join(a.mediaDir, f)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			log.Printf("could not create %s: %v", dir, err)
			continue
		}
		readme := filepath.Join(dir, "README.txt")
		if _, err := os.Stat(readme); os.IsNotExist(err) {
			_ = os.WriteFile(readme, []byte(mediaReadme(f)), 0o644)
		}
	}
}

func mediaReadme(folder string) string {
	return fmt.Sprintf(`Put your own content for the "%s" stage in this folder.

Supported files:
  Videos : .mp4 .webm (H.264 MP4 is the safest choice)
  Images : .jpg .png .gif .webp
  Sounds : .mp3 .wav .ogg .m4a

Then open Setup (press S), go to "My media" and set this stage to "My media" or "Mix".
A random file is picked every time the stage starts.
Videos play with their own sound. A sound file is played instead of the talking voice.
`, folder)
}

func (a *app) handleSettings(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	switch r.Method {
	case http.MethodGet:
		b, err := os.ReadFile(a.settingsPath)
		if os.IsNotExist(err) {
			writeJSON(w, map[string]any{})
			return
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(b)
	case http.MethodPost, http.MethodPut:
		b, err := io.ReadAll(io.LimitReader(r.Body, maxSettingsBytes+1))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if len(b) > maxSettingsBytes {
			http.Error(w, "settings too large (max 4 MB)", http.StatusRequestEntityTooLarge)
			return
		}
		var probe map[string]any
		if err := json.Unmarshal(b, &probe); err != nil {
			http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
			return
		}
		if probe == nil { // body was `null`
			http.Error(w, "settings must be a JSON object", http.StatusBadRequest)
			return
		}
		pretty, _ := json.MarshalIndent(probe, "", "  ")
		tmp := a.settingsPath + ".tmp"
		if err := writeFileSync(tmp, pretty); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := os.Rename(tmp, a.settingsPath); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{"ok": true, "path": a.settingsPath, "rev": a.settingsRev()})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (a *app) handleMediaList(w http.ResponseWriter, r *http.Request) {
	out := map[string][]string{}
	for _, f := range mediaFolders {
		out[f] = []string{}
		entries, err := os.ReadDir(filepath.Join(a.mediaDir, f))
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if mediaExts[strings.ToLower(filepath.Ext(e.Name()))] {
				out[f] = append(out[f], "/media/"+f+"/"+urlPathEscape(e.Name()))
			}
		}
		sort.Strings(out[f])
	}
	writeJSON(w, out)
}

func urlPathEscape(s string) string {
	r := strings.NewReplacer("%", "%25", " ", "%20", "#", "%23", "?", "%3F", "&", "%26", "+", "%2B")
	return r.Replace(s)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

// noCache makes sure the browser always loads the app version embedded in this exe.
func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/models/") && !strings.HasPrefix(r.URL.Path, "/vendor/") {
			w.Header().Set("Cache-Control", "no-cache")
		}
		h.ServeHTTP(w, r)
	})
}

func waitForEnter() {
	fmt.Println("Press Enter to close.")
	var s string
	_, _ = fmt.Scanln(&s)
}

const maxSettingsBytes = 4 << 20

// writeFileSync writes and flushes to disk, so a power cut right after saving can't leave an empty file.
func writeFileSync(path string, data []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// isOurServer reports whether a Spooky Treat Station answers at url (and not some other program),
// and whether a show page is currently open in a browser.
func isOurServer(client *http.Client, url string) (ours, pageActive bool) {
	resp, err := client.Get(url)
	if err != nil {
		return false, false
	}
	defer resp.Body.Close()
	var info struct {
		Version    string `json:"version"`
		DataDir    string `json:"dataDir"`
		PageActive bool   `json:"pageActive"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&info) != nil {
		return false, false
	}
	return info.Version != "" && info.DataDir != "", info.PageActive
}

// handleState is polled by the show page every couple of seconds. It tells the page when settings.json
// or the media folders changed (e.g. saved from another window, or edited by hand), so changes apply
// without restarting, and when it should open its setup screen.
func (a *app) handleState(w http.ResponseWriter, r *http.Request) {
	a.lastPoll.Store(time.Now().UnixNano())
	writeJSON(w, map[string]any{
		"settingsRev": a.settingsRev(),
		"mediaRev":    a.mediaRev(),
		"openSetup":   a.openSetupSeq.Load(),
	})
}

func (a *app) handleOpenSetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "seq": a.openSetupSeq.Add(1)})
}

func (a *app) pageActive() bool {
	return time.Since(time.Unix(0, a.lastPoll.Load())) < 6*time.Second
}

// settingsRev changes whenever settings.json is written.
func (a *app) settingsRev() string {
	st, err := os.Stat(a.settingsPath)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%d-%d", st.ModTime().UnixNano(), st.Size())
}

// mediaRev changes whenever a file is added, removed or replaced in a media folder.
func (a *app) mediaRev() string {
	h := fnv.New64a()
	for _, f := range mediaFolders {
		entries, _ := os.ReadDir(filepath.Join(a.mediaDir, f))
		for _, e := range entries {
			if info, err := e.Info(); err == nil {
				fmt.Fprintf(h, "%s/%s:%d:%d;", f, e.Name(), info.Size(), info.ModTime().UnixNano())
			}
		}
	}
	return fmt.Sprintf("%x", h.Sum64())
}

// localOnly blocks requests that don't come from our own page: a wrong Host header (DNS rebinding)
// or a cross-site Origin. Without this, any website open on the PC could change settings or quit the show.
func localOnly(port int, h http.Handler) http.Handler {
	hosts := map[string]bool{
		fmt.Sprintf("127.0.0.1:%d", port): true,
		fmt.Sprintf("localhost:%d", port): true,
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hosts[r.Host] {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if o := r.Header.Get("Origin"); o != "" && !hosts[strings.TrimPrefix(o, "http://")] {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h.ServeHTTP(w, r)
	})
}

// noListing hides directory listings (only real files are served).
func noListing(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "" && strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		h.ServeHTTP(w, r)
	})
}
