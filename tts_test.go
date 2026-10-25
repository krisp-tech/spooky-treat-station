package main

// Natural voices (Piper). Tests that need the real Piper program use the Linux build downloaded by
// `scripts/fetch-voices.sh linux` (or STS_PIPER / STS_VOICES); they are skipped if it isn't there.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func piperForTest(t *testing.T) (exe, voices string) {
	t.Helper()
	exe, voices = os.Getenv("STS_PIPER"), os.Getenv("STS_VOICES")
	if exe == "" {
		exe = filepath.Join(".cache", "piper", "linux", "piper", "piper")
	}
	if voices == "" {
		voices = filepath.Join(".cache", "piper", "voices")
	}
	if _, err := os.Stat(exe); err != nil {
		t.Skip("Piper not downloaded (run scripts/fetch-voices.sh linux)")
	}
	return exe, voices
}

func ttsPost(t *testing.T, s *ttsService, body string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	s.handleSynth(w, httptest.NewRequest("POST", "/api/tts", bytes.NewReader([]byte(body))))
	return w
}

const testVoice = "en-us-libritts-high"

// TTS-01: without Piper the service says so (the app then uses Windows voices)
func TestTTSUnavailableWithoutPiper(t *testing.T) {
	dir := t.TempDir()
	s := newTTS(filepath.Join(dir, "nope", "piper"), filepath.Join(dir, "voices"), filepath.Join(dir, "cache"))
	w := httptest.NewRecorder()
	s.handleStatus(w, httptest.NewRequest("GET", "/api/tts/status", nil))
	var st map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &st)
	if st["available"] != false || st["reason"] == "" {
		t.Fatalf("status: %v", st)
	}
	if w := ttsPost(t, s, `{"text":"hi","voice":"x"}`); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("synth without piper: %d", w.Code)
	}
}

// TTS-02: generate once (miss), then served from the saved file (hit); checkOnly reports both states
func TestTTSGenerateAndCache(t *testing.T) {
	exe, voices := piperForTest(t)
	s := newTTS(exe, voices, t.TempDir())
	defer s.stopAll()
	req := `{"text":"Trick or treat!","voice":"` + testVoice + `","speaker":624,"lengthScale":1.06%s}`
	if w := ttsPost(t, s, fmt.Sprintf(req, `,"checkOnly":true`)); w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"ready":false`)) {
		t.Fatalf("checkOnly before generating: %d %s", w.Code, w.Body.String())
	}
	w := ttsPost(t, s, fmt.Sprintf(req, ""))
	if w.Code != 200 || w.Header().Get("X-TTS-Cache") != "miss" || !bytes.HasPrefix(w.Body.Bytes(), []byte("RIFF")) || w.Body.Len() < 10000 {
		t.Fatalf("first: %d %s %d bytes %q", w.Code, w.Header().Get("X-TTS-Cache"), w.Body.Len(), w.Body.String()[:min(60, w.Body.Len())])
	}
	t0 := time.Now()
	w2 := ttsPost(t, s, fmt.Sprintf(req, ""))
	if w2.Code != 200 || w2.Header().Get("X-TTS-Cache") != "hit" || !bytes.Equal(w.Body.Bytes(), w2.Body.Bytes()) {
		t.Fatalf("second: %d %s", w2.Code, w2.Header().Get("X-TTS-Cache"))
	}
	if time.Since(t0) > 200*time.Millisecond {
		t.Fatalf("cached phrase took %v", time.Since(t0))
	}
	if w := ttsPost(t, s, fmt.Sprintf(req, `,"checkOnly":true`)); w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"ready":true`)) {
		t.Fatalf("checkOnly after generating: %d %s", w.Code, w.Body.String())
	}
	// a different speaker is a different voice -> different audio
	w3 := ttsPost(t, s, `{"text":"Trick or treat!","voice":"`+testVoice+`","speaker":42,"lengthScale":1.06}`)
	if w3.Code != 200 || bytes.Equal(w3.Body.Bytes(), w.Body.Bytes()) {
		t.Fatalf("speaker 42: %d, same audio=%v", w3.Code, bytes.Equal(w3.Body.Bytes(), w.Body.Bytes()))
	}
}

// TTS-03: bad requests are rejected (unknown or path-like voice, speaker out of range, empty/long text, speed)
func TestTTSValidation(t *testing.T) {
	exe, voices := piperForTest(t)
	s := newTTS(exe, voices, t.TempDir())
	defer s.stopAll()
	long := string(bytes.Repeat([]byte("a"), maxTTSChars+1))
	for _, body := range []string{
		`{"text":"hi","voice":"../../etc/passwd","speaker":0}`,
		`{"text":"hi","voice":"nope","speaker":0}`,
		`{"text":"hi","voice":"` + testVoice + `","speaker":904}`,
		`{"text":"hi","voice":"` + testVoice + `","speaker":-1}`,
		`{"text":"   ","voice":"` + testVoice + `","speaker":0}`,
		`{"text":"` + long + `","voice":"` + testVoice + `","speaker":0}`,
		`{"text":"hi","voice":"` + testVoice + `","speaker":0,"lengthScale":9}`,
		`not json`,
	} {
		if w := ttsPost(t, s, body); w.Code != http.StatusBadRequest {
			t.Errorf("%.60s -> %d (want 400)", body, w.Code)
		}
	}
	w := httptest.NewRecorder()
	s.handleSynth(w, httptest.NewRequest("GET", "/api/tts", nil))
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET -> %d", w.Code)
	}
}

// TTS-04: simultaneous requests for the same new phrase: all succeed, generated once
func TestTTSConcurrentSamePhrase(t *testing.T) {
	exe, voices := piperForTest(t)
	cache := t.TempDir()
	s := newTTS(exe, voices, cache)
	defer s.stopAll()
	var wg sync.WaitGroup
	codes := make([]string, 4)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := ttsPost(t, s, `{"text":"Happy Halloween!","voice":"`+testVoice+`","speaker":60,"lengthScale":1.18}`)
			codes[i] = fmt.Sprintf("%d/%s", w.Code, w.Header().Get("X-TTS-Cache"))
		}(i)
	}
	wg.Wait()
	misses := 0
	for _, c := range codes {
		if c[:3] != "200" {
			t.Fatalf("codes %v", codes)
		}
		if c == "200/miss" {
			misses++
		}
	}
	if misses != 1 {
		t.Errorf("generated %d times (want 1): %v", misses, codes)
	}
	files, _ := filepath.Glob(filepath.Join(cache, "*"))
	if len(files) != 1 {
		t.Errorf("cache files %v (want exactly 1, no leftover temp files)", files)
	}
}

// TTS-05: if the Piper process dies, the next request starts a new one
func TestTTSRecoversFromPiperCrash(t *testing.T) {
	exe, voices := piperForTest(t)
	s := newTTS(exe, voices, t.TempDir())
	defer s.stopAll()
	if w := ttsPost(t, s, `{"text":"One","voice":"`+testVoice+`","speaker":1}`); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	s.mu.Lock()
	for _, p := range s.procs {
		_ = p.cmd.Process.Kill()
	}
	s.mu.Unlock()
	time.Sleep(200 * time.Millisecond)
	if w := ttsPost(t, s, `{"text":"Two","voice":"`+testVoice+`","speaker":1}`); w.Code != 200 {
		// the first request after a crash may report the crash; the one after must work
		if w := ttsPost(t, s, `{"text":"Two","voice":"`+testVoice+`","speaker":1}`); w.Code != 200 {
			t.Fatalf("after crash: %d %s", w.Code, w.Body.String())
		}
	}
}
