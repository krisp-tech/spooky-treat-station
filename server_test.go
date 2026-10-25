package main

// Integration tests: build the real launcher binary once and run it as a subprocess
// (routing, MIME types, path traversal, quit, port-in-use, data folder creation).
// Set STS_BIN to reuse a prebuilt binary (test/run-all.sh does this).

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

var (
	binOnce sync.Once
	binPath string
	binErr  error
)

func stsBinary(t *testing.T) string {
	t.Helper()
	binOnce.Do(func() {
		if p := os.Getenv("STS_BIN"); p != "" {
			binPath = p
			return
		}
		goTool := filepath.Join(runtime.GOROOT(), "bin", "go")
		if _, err := os.Stat(goTool); err != nil {
			goTool = "go"
		}
		dir, err := os.MkdirTemp("", "sts-bin-")
		if err != nil {
			binErr = err
			return
		}
		binPath = filepath.Join(dir, "sts")
		out, err := exec.Command(goTool, "build", "-o", binPath, ".").CombinedOutput()
		if err != nil {
			binErr = fmt.Errorf("go build: %v\n%s", err, out)
		}
	})
	if binErr != nil {
		t.Fatal(binErr)
	}
	return binPath
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

type proc struct {
	cmd  *exec.Cmd
	out  *syncBuf
	port int
	data string
	done chan error
}

type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.b.Write(p) }
func (s *syncBuf) String() string              { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

// startSTS starts the launcher with -no-browser on a free port and waits until /api/info answers.
func startSTS(t *testing.T, data string, extra ...string) *proc {
	t.Helper()
	if data == "" {
		data = t.TempDir()
	}
	p := &proc{port: freePort(t), data: data, out: &syncBuf{}, done: make(chan error, 1)}
	args := append([]string{"-no-browser", "-port", fmt.Sprint(p.port), "-data", data}, extra...)
	p.cmd = exec.Command(stsBinary(t), args...)
	p.cmd.Stdout, p.cmd.Stderr = p.out, p.out
	if err := p.cmd.Start(); err != nil {
		t.Fatal(err)
	}
	go func() { p.done <- p.cmd.Wait() }()
	t.Cleanup(func() { _ = p.cmd.Process.Kill(); <-p.done })
	for i := 0; i < 100; i++ {
		if r, err := http.Get(p.url("/api/info")); err == nil {
			r.Body.Close()
			return p
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("server did not start:\n%s", p.out.String())
	return nil
}

func (p *proc) url(path string) string { return fmt.Sprintf("http://127.0.0.1:%d%s", p.port, path) }

func get(t *testing.T, url string) (*http.Response, string) {
	t.Helper()
	c := http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }, Timeout: 5 * time.Second}
	r, err := c.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return r, string(b)
}

// rawGet sends the request path byte-for-byte (no client-side cleaning), returns status line + body.
func rawGet(t *testing.T, port int, path string, host string) (string, string) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 2*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	if host == "" {
		host = fmt.Sprintf("127.0.0.1:%d", port)
	}
	fmt.Fprintf(conn, "GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", path, host)
	all, _ := io.ReadAll(conn)
	s := string(all)
	line, _, _ := strings.Cut(s, "\r\n")
	_, body, _ := strings.Cut(s, "\r\n\r\n")
	return line, body
}

// SRV-01
func TestServerCreatesDataFolderMediaFoldersAndReadmes(t *testing.T) {
	data := filepath.Join(t.TempDir(), "does", "not", "exist yet")
	p := startSTS(t, data)
	for _, f := range mediaFolders {
		if _, err := os.Stat(filepath.Join(data, "media", f, "README.txt")); err != nil {
			t.Errorf("%s: %v", f, err)
		}
	}
	if _, err := os.Stat(filepath.Join(data, "settings.json")); !os.IsNotExist(err) {
		t.Errorf("settings.json must not be created before the first Save")
	}
	_, body := get(t, p.url("/api/info"))
	var info map[string]string
	_ = json.Unmarshal([]byte(body), &info)
	if info["dataDir"] != data || info["mediaDir"] != filepath.Join(data, "media") {
		t.Fatalf("info %v", info)
	}
}

// SRV-02
func TestServerMimeTypesAndCaching(t *testing.T) {
	p := startSTS(t, "")
	cases := []struct{ path, ctype, cache string }{
		{"/", "text/html; charset=utf-8", "no-cache"},
		{"/index.html", "", ""}, // redirects to /
		{"/js/main.js", "text/javascript", "no-cache"},
		{"/js/detect-worker.js", "text/javascript", "no-cache"},
		{"/vendor/mediapipe/vision_bundle.mjs", "text/javascript", ""},
		{"/vendor/mediapipe/vision_bundle.cjs", "text/javascript", ""},
		{"/vendor/mediapipe/wasm/vision_wasm_internal.wasm", "application/wasm", ""},
		{"/vendor/mediapipe/wasm/vision_wasm_internal.js", "text/javascript", ""},
		{"/css/style.css", "text/css; charset=utf-8", "no-cache"},
		{"/fonts/creepster.woff2", "font/woff2", "no-cache"},
		{"/models/efficientdet_lite0.tflite", "application/octet-stream", ""},
		{"/models/pose_landmarker_lite.task", "application/octet-stream", ""},
	}
	for _, c := range cases {
		r, _ := get(t, p.url(c.path))
		if c.ctype == "" {
			continue
		}
		if r.StatusCode != 200 {
			t.Errorf("%s: status %d", c.path, r.StatusCode)
			continue
		}
		got := r.Header.Get("Content-Type")
		gotType, _, _ := mime.ParseMediaType(got)
		wantType, _, _ := mime.ParseMediaType(c.ctype)
		if gotType != wantType { // parameters such as charset=utf-8 are fine
			t.Errorf("%s: Content-Type %q, want %q", c.path, got, c.ctype)
		}
		if got := r.Header.Get("Cache-Control"); got != c.cache {
			t.Errorf("%s: Cache-Control %q, want %q", c.path, got, c.cache)
		}
	}
	r, _ := get(t, p.url("/nope.js"))
	if r.StatusCode != 404 {
		t.Errorf("missing file: %d", r.StatusCode)
	}
}

// SRV-03
func TestServerMediaFilesServedWithOddNamesTypesAndRanges(t *testing.T) {
	p := startSTS(t, "")
	dir := filepath.Join(p.data, "media", "near-kids")
	content := map[string]string{}
	for i, n := range oddNames() {
		if strings.HasSuffix(n, " ") {
			continue
		}
		c := fmt.Sprintf("file-%02d-%s", i, strings.Repeat("z", 50))
		if err := os.WriteFile(filepath.Join(dir, n), []byte(c), 0o644); err == nil {
			content[n] = c
		}
	}
	_, body := get(t, p.url("/api/media"))
	var list map[string][]string
	_ = json.Unmarshal([]byte(body), &list)
	if len(list["near-kids"]) != len(content) {
		t.Fatalf("listed %d of %d files", len(list["near-kids"]), len(content))
	}
	for _, u := range list["near-kids"] {
		r, b := get(t, p.url(u))
		if r.StatusCode != 200 || !strings.HasPrefix(b, "file-") {
			t.Errorf("GET %s -> %d %q", u, r.StatusCode, b)
		}
	}
	// video needs byte ranges for seeking; types for the common formats
	_ = os.WriteFile(filepath.Join(dir, "v.mp4"), bytes.Repeat([]byte{1}, 1000), 0o644)
	req, _ := http.NewRequest("GET", p.url("/media/near-kids/v.mp4"), nil)
	req.Header.Set("Range", "bytes=0-9")
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 206 || r.Header.Get("Content-Type") != "video/mp4" {
		t.Errorf("range request: %d %q", r.StatusCode, r.Header.Get("Content-Type"))
	}
	for n, want := range map[string]string{"a.webm": "video/webm", "a.mp3": "audio/mpeg", "a.png": "image/png", "a.jpg": "image/jpeg", "a.wav": "audio/"} {
		_ = os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644)
		r, _ := get(t, p.url("/media/near-kids/"+n))
		if !strings.HasPrefix(r.Header.Get("Content-Type"), want) {
			t.Errorf("%s: Content-Type %q", n, r.Header.Get("Content-Type"))
		}
	}
}

// SRV-04
func TestServerPathTraversalBlocked(t *testing.T) {
	data := t.TempDir()
	const secret = "TOP-SECRET-MARKER-6f1d"
	_ = os.WriteFile(filepath.Join(data, "settings.json"), []byte(`{"s":"`+secret+`"}`), 0o644)
	_ = os.WriteFile(filepath.Join(data, "secret.txt"), []byte(secret), 0o644)
	_ = os.MkdirAll(filepath.Join(data, "browser-profile", "Default"), 0o755)
	_ = os.WriteFile(filepath.Join(data, "browser-profile", "Default", "Preferences"), []byte(secret), 0o644)
	p := startSTS(t, data)
	paths := []string{
		"/media/../secret.txt", "/media/../settings.json", "/media/idle/../../secret.txt",
		"/media/%2e%2e/secret.txt", "/media/%2E%2E/secret.txt", "/media/..%2fsecret.txt", "/media/..%2Fsecret.txt",
		"/media/%2e%2e%2fsecret.txt", "/media/idle/%2e%2e/%2e%2e/secret.txt", "/media/..%5csecret.txt", "/media/..\\secret.txt",
		"/media//../secret.txt", "/media/%252e%252e/secret.txt", "/media/../browser-profile/Default/Preferences",
		"/../secret.txt", "/..%2fsecret.txt", "/%2e%2e/secret.txt", "/js/../../secret.txt", "/vendor/..%2f..%2fsecret.txt",
		"/media/..;/secret.txt", "/media/.%2e/secret.txt", "/media/%c0%ae%c0%ae/secret.txt",
		"/../main.go", "/../../etc/passwd", "/media/../../../../../../etc/passwd", "/media/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
	}
	for _, path := range paths {
		status, body := rawGet(t, p.port, path, "")
		if strings.Contains(body, secret) || strings.Contains(body, "root:x:0:0") || strings.Contains(body, "package main") {
			t.Errorf("TRAVERSAL: %s -> %s leaked file content", path, status)
		}
	}
	// only the API returns settings
	_, body := get(t, p.url("/api/settings"))
	if !strings.Contains(body, secret) {
		t.Fatalf("sanity: /api/settings should return the settings")
	}
}

// SRV-05
func TestServerQuitOnlyViaPost(t *testing.T) {
	p := startSTS(t, "")
	for _, m := range []string{"GET", "PUT", "DELETE", "HEAD"} {
		req, _ := http.NewRequest(m, p.url("/api/quit"), nil)
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("%s /api/quit: %d", m, r.StatusCode)
		}
	}
	time.Sleep(600 * time.Millisecond)
	if _, err := http.Get(p.url("/api/info")); err != nil {
		t.Fatalf("server died after non-POST quit: %v", err)
	}
	r, err := http.Post(p.url("/api/quit"), "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	if !strings.Contains(string(b), `"ok":true`) {
		t.Fatalf("quit response %s", b)
	}
	select {
	case err := <-p.done:
		p.done <- err
		if err != nil {
			t.Fatalf("exit status: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("process still running 3 s after POST /api/quit")
	}
}

// runSecond runs another launcher on a port and returns its output, exit error and duration.
func runSecond(t *testing.T, port int, timeout time.Duration) (string, error, time.Duration) {
	t.Helper()
	cmd := exec.Command(stsBinary(t), "-no-browser", "-port", fmt.Sprint(port), "-data", t.TempDir())
	cmd.Stdin = strings.NewReader("\n")
	var out syncBuf
	cmd.Stdout, cmd.Stderr = &out, &out
	start := time.Now()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return out.String(), err, time.Since(start)
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		<-done
		return out.String(), fmt.Errorf("timeout"), time.Since(start)
	}
}

// SRV-06
func TestServerPortInUseByAnotherInstanceOpensItAndExits(t *testing.T) {
	p := startSTS(t, "")
	out, err, d := runSecond(t, p.port, 10*time.Second)
	if err != nil || !strings.Contains(out, "already running") {
		t.Fatalf("second instance: err=%v after %v\n%s", err, d, out)
	}
	if _, err := http.Get(p.url("/api/info")); err != nil {
		t.Fatal("first instance died")
	}
}

// SRV-07
func TestServerPortInUseByOtherHTTPProgramIsReported(t *testing.T) {
	// Another program (not Spooky Treat Station) serves HTTP on the port and answers 404 to /api/info.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.NotFoundHandler()}
	go srv.Serve(l)
	defer srv.Close()
	port := l.Addr().(*net.TCPAddr).Port
	out, err, _ := runSecond(t, port, 10*time.Second)
	if strings.Contains(out, "already running") || err == nil {
		t.Fatalf("a foreign web server on the port was mistaken for a running Spooky Treat Station (exit err=%v):\n%s", err, out)
	}
}

// SRV-08
func TestServerPortInUseByNonHTTPProgramIsReported(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func() { bufio.NewReader(c).ReadString('\n'); c.Write([]byte("HELLO not http\r\n")); c.Close() }()
		}
	}()
	port := l.Addr().(*net.TCPAddr).Port
	out, err, d := runSecond(t, port, 15*time.Second)
	if err == nil || !strings.Contains(out, "Could not start") {
		t.Fatalf("expected a clear error + exit code 1, got err=%v after %v:\n%s", err, d, out)
	}
	if ee, ok := err.(*exec.ExitError); !ok || ee.ExitCode() != 1 {
		t.Fatalf("exit: %v", err)
	}
}

// SRV-09
func TestServerSettingsRoundTripOverHTTP(t *testing.T) {
	p := startSTS(t, "")
	r, err := http.Post(p.url("/api/settings"), "application/json", strings.NewReader(`{"zones":{"nearLine":0.5}}`))
	if err != nil || r.StatusCode != 200 {
		t.Fatalf("%v %v", err, r)
	}
	r.Body.Close()
	_, body := get(t, p.url("/api/settings"))
	if !strings.Contains(body, `"nearLine": 0.5`) {
		t.Fatalf("got %s", body)
	}
	raw, _ := os.ReadFile(filepath.Join(p.data, "settings.json"))
	if !strings.Contains(string(raw), "nearLine") {
		t.Fatalf("file %s", raw)
	}
}

// SRV-10
func TestServerRejectsCrossSiteSettingsWrite(t *testing.T) {
	// Any web page open in any browser on this PC can send a "simple" cross-origin POST (text/plain, no preflight).
	p := startSTS(t, "")
	req, _ := http.NewRequest("POST", p.url("/api/settings"), strings.NewReader(`{"scare":{"kidsEnabled":true,"adultLevel":"max","strobe":true}}`))
	req.Header.Set("Content-Type", "text/plain;charset=UTF-8")
	req.Header.Set("Origin", "http://evil.example")
	r, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	raw, _ := os.ReadFile(filepath.Join(p.data, "settings.json"))
	if r.StatusCode == 200 || strings.Contains(string(raw), "strobe") {
		t.Fatalf("cross-site POST from http://evil.example was accepted (%d); settings.json now: %s", r.StatusCode, raw)
	}
}

// SRV-11
func TestServerRejectsCrossSiteQuit(t *testing.T) {
	p := startSTS(t, "")
	req, _ := http.NewRequest("POST", p.url("/api/quit"), strings.NewReader(""))
	req.Header.Set("Content-Type", "text/plain")
	req.Header.Set("Origin", "http://evil.example")
	r, err := http.DefaultClient.Do(req)
	if err == nil {
		r.Body.Close()
	}
	time.Sleep(800 * time.Millisecond)
	if _, err := http.Get(p.url("/api/info")); err != nil {
		t.Fatalf("a cross-site POST from http://evil.example shut the show down")
	}
}

// SRV-12
func TestServerRejectsForeignHostHeader(t *testing.T) {
	// DNS rebinding: a site whose name resolves to 127.0.0.1 can read the API unless the Host header is checked.
	p := startSTS(t, "")
	_ = os.WriteFile(filepath.Join(p.data, "settings.json"), []byte(`{"x":1}`), 0o644)
	status, _ := rawGet(t, p.port, "/api/info", "rebind.evil.example:"+fmt.Sprint(p.port))
	if strings.Contains(status, " 200 ") {
		t.Fatalf("request with Host: rebind.evil.example was answered: %s", status)
	}
}

// SRV-13
func TestServerSurvivesMediaDirRemovedWhileRunning(t *testing.T) {
	p := startSTS(t, "")
	_ = os.RemoveAll(filepath.Join(p.data, "media"))
	r, body := get(t, p.url("/api/media"))
	if r.StatusCode != 200 || !strings.Contains(body, `"idle":[]`) {
		t.Fatalf("%d %s", r.StatusCode, body)
	}
	r, _ = get(t, p.url("/media/idle/x.mp4"))
	if r.StatusCode != 404 {
		t.Fatalf("%d", r.StatusCode)
	}
}
