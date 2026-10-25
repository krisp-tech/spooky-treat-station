package main

// Natural-sounding offline voices with Piper (https://github.com/rhasspy/piper).
//
// The launcher keeps one Piper process per (voice model, speed) loaded and feeds it one JSON line per
// phrase. Every generated phrase is saved in voice-cache/, so it only has to be generated once: after
// that it plays instantly, even after a restart. If Piper or a voice is missing, the app falls back to
// the Windows voices.

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxTTSChars = 400

type ttsService struct {
	piperExe  string
	voicesDir string
	cacheDir  string

	mu    sync.Mutex
	procs map[string]*piperProc
}

type voiceInfo struct {
	Name     string `json:"name"`
	Speakers int    `json:"speakers"`
	Rate     int    `json:"sampleRate"`
}

type piperProc struct {
	mu     sync.Mutex // one phrase at a time per process
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	lines  chan string
	exited chan struct{}
}

func newTTS(piperExe, voicesDir, cacheDir string) *ttsService {
	// absolute paths: Piper runs in its own folder, so relative paths would point somewhere else
	abs := func(p string) string {
		if a, err := filepath.Abs(p); err == nil {
			return a
		}
		return p
	}
	return &ttsService{piperExe: abs(piperExe), voicesDir: abs(voicesDir), cacheDir: abs(cacheDir), procs: map[string]*piperProc{}}
}

func defaultPiperExe(dir string) string {
	name := "piper"
	if runtime.GOOS == "windows" {
		name = "piper.exe"
	}
	return filepath.Join(dir, "piper", name)
}

// voices lists the Piper voice models (*.onnx with their .onnx.json) in the voices folder.
func (t *ttsService) voices() []voiceInfo {
	entries, _ := os.ReadDir(t.voicesDir)
	var out []voiceInfo
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".onnx") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(t.voicesDir, e.Name()+".json"))
		if err != nil {
			continue
		}
		var cfg struct {
			NumSpeakers int `json:"num_speakers"`
			Audio       struct {
				SampleRate int `json:"sample_rate"`
			} `json:"audio"`
		}
		if json.Unmarshal(b, &cfg) != nil {
			continue
		}
		if cfg.NumSpeakers < 1 {
			cfg.NumSpeakers = 1
		}
		out = append(out, voiceInfo{Name: strings.TrimSuffix(e.Name(), filepath.Ext(e.Name())), Speakers: cfg.NumSpeakers, Rate: cfg.Audio.SampleRate})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func (t *ttsService) status() (available bool, reason string, voices []voiceInfo) {
	if st, err := os.Stat(t.piperExe); err != nil || st.IsDir() {
		return false, "Piper not found (" + t.piperExe + ")", nil
	}
	voices = t.voices()
	if len(voices) == 0 {
		return false, "no voices in " + t.voicesDir, nil
	}
	return true, "", voices
}

type ttsRequest struct {
	Text        string  `json:"text"`
	Voice       string  `json:"voice"`
	Speaker     int     `json:"speaker"`
	LengthScale float64 `json:"lengthScale"`
	CheckOnly   bool    `json:"checkOnly"` // only answer {ready: true/false}
}

func (t *ttsService) cachePath(r ttsRequest) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%.2f|%s", r.Voice, r.Speaker, r.LengthScale, r.Text)))
	return filepath.Join(t.cacheDir, hex.EncodeToString(h[:16])+".wav")
}

// synth returns the path of a wav file for the request, generating it if needed.
func (t *ttsService) synth(r ttsRequest) (path string, cached bool, err error) {
	out := t.cachePath(r)
	if st, err := os.Stat(out); err == nil && st.Size() > 44 {
		return out, true, nil
	}
	if err := os.MkdirAll(t.cacheDir, 0o755); err != nil {
		return "", false, err
	}
	p, err := t.proc(r.Voice, r.LengthScale)
	if err != nil {
		return "", false, err
	}
	tmp := out + fmt.Sprintf(".%d.tmp.wav", time.Now().UnixNano())
	line, _ := json.Marshal(map[string]any{"text": r.Text, "speaker_id": r.Speaker, "output_file": tmp})

	p.mu.Lock()
	defer p.mu.Unlock()
	// another request may have generated the same phrase while we waited for our turn
	if st, err := os.Stat(out); err == nil && st.Size() > 44 {
		return out, true, nil
	}
	if _, err := fmt.Fprintf(p.stdin, "%s\n", line); err != nil {
		t.drop(r.Voice, r.LengthScale, p)
		return "", false, fmt.Errorf("piper stopped: %w", err)
	}
	timeout := time.After(90 * time.Second) // a slow PC can take a while for the very first phrase
	for {
		select {
		case l := <-p.lines:
			if strings.TrimSpace(l) != tmp {
				continue // other output
			}
			if err := os.Rename(tmp, out); err != nil {
				return "", false, err
			}
			return out, false, nil
		case <-p.exited:
			t.drop(r.Voice, r.LengthScale, p)
			os.Remove(tmp)
			return "", false, errors.New("piper exited unexpectedly")
		case <-timeout:
			t.drop(r.Voice, r.LengthScale, p)
			os.Remove(tmp)
			return "", false, errors.New("piper timed out")
		}
	}
}

func procKey(voice string, lengthScale float64) string {
	return fmt.Sprintf("%s|%.2f", voice, lengthScale)
}

// proc returns a running Piper process for the voice and speed, starting one if needed.
func (t *ttsService) proc(voice string, lengthScale float64) (*piperProc, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	key := procKey(voice, lengthScale)
	if p := t.procs[key]; p != nil {
		return p, nil
	}
	model := filepath.Join(t.voicesDir, voice+".onnx")
	cmd := exec.Command(t.piperExe, "--model", model, "--json-input", "--length_scale", fmt.Sprintf("%.2f", lengthScale), "--sentence_silence", "0.15")
	cmd.Dir = filepath.Dir(t.piperExe)
	hideWindow(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting piper: %w", err)
	}
	p := &piperProc{cmd: cmd, stdin: stdin, lines: make(chan string, 16), exited: make(chan struct{})}
	go func() {
		sc := bufio.NewScanner(stdout)
		for sc.Scan() {
			p.lines <- sc.Text()
		}
	}()
	go func() { _ = cmd.Wait(); close(p.exited) }()
	t.procs[key] = p
	return p, nil
}

func (t *ttsService) drop(voice string, lengthScale float64, p *piperProc) {
	t.mu.Lock()
	if t.procs[procKey(voice, lengthScale)] == p {
		delete(t.procs, procKey(voice, lengthScale))
	}
	t.mu.Unlock()
	_ = p.stdin.Close()
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
}

func (t *ttsService) stopAll() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for k, p := range t.procs {
		_ = p.stdin.Close()
		if p.cmd.Process != nil {
			_ = p.cmd.Process.Kill()
		}
		delete(t.procs, k)
	}
}

// ---------------------------------------------------------------- HTTP

func (t *ttsService) handleStatus(w http.ResponseWriter, r *http.Request) {
	ok, reason, voices := t.status()
	if voices == nil {
		voices = []voiceInfo{}
	}
	writeJSON(w, map[string]any{"available": ok, "reason": reason, "voices": voices})
}

func (t *ttsService) handleSynth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req ttsRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	req.Text = strings.TrimSpace(strings.ReplaceAll(req.Text, "\n", " "))
	if req.Text == "" || len([]rune(req.Text)) > maxTTSChars {
		http.Error(w, fmt.Sprintf("text must be 1-%d characters", maxTTSChars), http.StatusBadRequest)
		return
	}
	if req.LengthScale == 0 {
		req.LengthScale = 1
	}
	if req.LengthScale < 0.3 || req.LengthScale > 3 {
		http.Error(w, "lengthScale must be 0.3-3", http.StatusBadRequest)
		return
	}
	ok, reason, voices := t.status()
	if !ok {
		http.Error(w, reason, http.StatusServiceUnavailable)
		return
	}
	var voice *voiceInfo
	for i := range voices {
		if voices[i].Name == req.Voice {
			voice = &voices[i]
		}
	}
	if voice == nil {
		http.Error(w, "unknown voice", http.StatusBadRequest)
		return
	}
	if req.Speaker < 0 || req.Speaker >= voice.Speakers {
		http.Error(w, fmt.Sprintf("speaker must be 0-%d", voice.Speakers-1), http.StatusBadRequest)
		return
	}
	if req.CheckOnly { // plain yes/no (a 404 would show up as an error in the browser console)
		st, err := os.Stat(t.cachePath(req))
		writeJSON(w, map[string]any{"ready": err == nil && st.Size() > 44})
		return
	}
	path, cached, err := t.synth(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "audio/wav")
	w.Header().Set("Cache-Control", "no-store")
	if cached {
		w.Header().Set("X-TTS-Cache", "hit")
	} else {
		w.Header().Set("X-TTS-Cache", "miss")
	}
	_, _ = w.Write(b)
}
