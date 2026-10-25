# Spooky Treat Station: Validation Test Plan

Independent validation of the launcher (Go) and the kiosk web app (ES modules), written as black-box and
white-box tests against the current code. This plan lists every test case. Each automated case has a
test ID, and the same ID appears in the test name so a failing run points back to this table.

## 1. Scope

**In scope**
- Launcher (`main.go`, `browser.go`): settings API, media listing and serving, static files and MIME types, path traversal, quit,
  port in use, data folder creation, camera pre-permission (`allowCamera`), browser command line.
- Web app logic: `settings.js`, `tracker.js`, `director.js`, `media.js` (unit level, in Node).
- Whole app in headless Chromium with a fake camera: start-up (camera present, denied, missing or late), the setup screen,
  keyboard shortcuts, custom media, speech and subtitles, mute, every built-in scene, resize and quality, flashing safety,
  robustness, performance sanity, long-run soak, and end to end with synthetic adult, child and group videos.

**Out of scope / manual only** (section 6): real Windows and Edge kiosk behaviour, real USB webcam at night, GPU delegate,
Windows voices, sleep prevention, autostart `.bat` files, and real Celeron performance.

## 2. Test levels and tools

| Level | Tool | Location | Run |
|---|---|---|---|
| Go unit (handlers) | `testing` + `net/http/httptest` | `api_test.go`, `browser_test.go`, `browser_extra_test.go` | `go test .` |
| Go integration (real binary as a subprocess) | `testing`, `os/exec` | `server_test.go` (builds the binary, or uses `STS_BIN`) | `go test .` |
| JS unit | `node:test` + `node:assert` (Node 22) | `test/unit/*.test.mjs` | `node --test test/unit/*.test.mjs` |
| Browser / integration | Playwright (headless Chromium, fake camera) | `test/browser/*.mjs` (shared `lib.mjs`) | `node test/browser/<file>.mjs <binary>` |
| End to end | Playwright + `.y4m` fake camera | `test/e2e.mjs --expect adults/kids` | via runner |
| Soak | Playwright | `test/browser/soak.mjs` (`SOAK_MIN`, default 3) | `SOAK=1` via runner |

The runner is `bash test/run-all.sh`. It builds `test/out/validation/sts`, creates the test videos if they are missing
(`test/make-test-videos.sh`: `approach.y4m` adult, `child.y4m` x0.62, `group.y4m` adult + child), then runs everything and prints a
pass/fail summary table. Logs go to `test/out/validation/`, which is gitignored. Options: `QUICK=1` runs only Go and unit tests,
and `SOAK=1 SOAK_MIN=n` adds the soak test. Ports: browser tests use 8811-8870, and Go tests pick free ports.

**Note on the Node environment.** Node 22 does not accept a bare directory in `node --test test/unit/`, so use the glob form.
Product modules are imported directly. The Node 22 ESM syntax detection handles `web/js/*.js` without a `package.json`.

**Testability notes**
- T1: `director.js` takes `now` in `update()`, but `go()` and the constructor read `performance.now()` themselves. Unit tests have to
  stub `globalThis.performance` with a fake clock that is shared with `now` (see `test/unit/helpers.mjs`). Test DI-47 shows that a
  caller passing a different time base breaks stage timing. The product is consistent today (`main.js` uses `performance.now()` everywhere).
  A `now` parameter on `go()`/`force()`, or an injectable clock, would remove this coupling.
- T2: The HTTP routing (`mux`) is built inside `main()`, so routing, MIME and traversal can only be tested against the real
  binary (`server_test.go`). A `newMux(a *app) http.Handler` function would allow in-process `httptest` tests.
- T3: `scenes.js` exports `Renderer`/`makeScene` and the page exposes `window.spooky`. This makes deterministic off-screen scene
  simulation possible (`test/browser/scenes.mjs`). There is no hook to inject detections into a running page (the camera loop
  overwrites `tracker.tracks`), so detection-driven browser tests rely on the fake camera videos.

## 3. Entry and exit criteria

Entry: the binary builds, Playwright Chromium starts, and the test videos exist. Exit: every case has been run at least once,
each failure has been checked to come from the product and not from the test, and each one is reported with severity and reproduction.

## 4. Test cases

Auto = automated (Y) or manual (N). Files are relative to the project root.

### 4.1 Launcher API (handlers): `api_test.go`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| API-01 | settings | GET /api/settings with no settings.json | 200 `{}`, JSON type, `no-store` | Y | api_test.go |
| API-02 | settings | POST nested settings (unicode, `<>&"`), then GET | identical JSON back; file pretty-printed; response has ok + path | Y | api_test.go |
| API-03 | settings | PUT instead of POST | saved (200) | Y | api_test.go |
| API-04 | settings | POST invalid JSON / array / string / number / trailing junk / bad UTF-8 | 400 each; file unchanged | Y | api_test.go |
| API-05 | settings | POST `null` | 400, file unchanged (a `null` file makes the next start a "first run") | Y | api_test.go |
| API-06 | settings | DELETE / PATCH | 405 | Y | api_test.go |
| API-07 | settings | 40 concurrent POSTs of ~20 KB plus GETs in parallel | every GET is valid JSON; final file is one complete body; no `.tmp` left (atomic write) | Y | api_test.go |
| API-08 | settings | temp file cannot be written | 500; previous settings.json kept | Y | api_test.go |
| API-09 | settings | corrupt settings.json on disk, GET then POST | GET does not crash the server; POST repairs it | Y | api_test.go |
| API-10 | settings | 3 MiB and 5 MiB bodies | 3 MiB accepted; 5 MiB rejected with 4xx (4 MiB limit) | Y | api_test.go |
| API-11 | media dirs | ensureMediaFolders on an empty data dir | 9 stage folders, each with README.txt naming the stage | Y | api_test.go |
| API-12 | media dirs | user-edited README and files present, run again | README and files untouched | Y | api_test.go |
| API-13 | media dirs | `media` path is a regular file | no panic; /api/media still 200 | Y | api_test.go |
| API-14 | media dirs | README text | refers to the real Setup tab "My media" (not "Content") | Y | api_test.go |
| API-15 | listing | empty folders; media folder deleted while running | all 9 keys present with `[]` | Y | api_test.go |
| API-16 | listing | odd names: spaces, `#`, `%`, `?`, `&+=`, `;`, unicode, emoji, brackets, quotes, `<>`, `\|*`, upper-case ext | every listed URL parses, has no query/fragment, decodes to the exact file name; sorted | Y | api_test.go |
| API-17 | listing | `.txt .pdf .avi .mkv`, Thumbs.db, hidden `.x.mp4`, no extension, `.part`, a folder named `x.mp4` | only `ok.mp4` listed | Y | api_test.go |
| API-18 | listing | urlPathEscape round trip for all odd names | decodes back to the name | Y | api_test.go |

### 4.2 Launcher integration (real binary): `server_test.go`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| SRV-01 | data dir | start with `-data` pointing to a nested, non-existent folder | folder, `media/<9>/README.txt` created; no settings.json before Save; /api/info reports the paths | Y | server_test.go |
| SRV-02 | MIME | GET `/`, `.js`, `.mjs`, `.cjs`, `.wasm`, `.css`, `.woff2`, `.tflite`, `.task` | correct media types (`text/javascript`, `application/wasm`, `text/css`, ...); `no-cache` except `/models/` and `/vendor/`; 404 for missing | Y | server_test.go |
| SRV-03 | media serve | every odd-named file through the listed URL; Range request; types of mp4/webm/mp3/png/jpg/wav | 200 with content; 206 + `video/mp4` for ranges; correct types | Y | server_test.go |
| SRV-04 | security | 26 traversal variants (`..`, `%2e%2e`, `%2f`, `%5c`, `\`, double-encoding, overlong UTF-8, `..;`) on `/media/` and `/` | no file outside media/web is ever returned (secret marker, /etc/passwd, main.go) | Y | server_test.go |
| SRV-05 | quit | GET/PUT/DELETE/HEAD /api/quit, then POST | 405 and still alive; POST returns ok and the process exits 0 within 3 s | Y | server_test.go |
| SRV-06 | port in use | second instance on the port of a running instance | prints "already running", exits 0; first instance unaffected | Y | server_test.go |
| SRV-07 | port in use | port taken by a different HTTP program (404 on /api/info) | reported as "could not start" with exit code 1; NOT treated as a running instance | Y | server_test.go |
| SRV-08 | port in use | port taken by a non-HTTP program | "Could not start" message, exit code 1 | Y | server_test.go |
| SRV-09 | settings | POST then GET over real HTTP | round trip; file written in the data dir | Y | server_test.go |
| SRV-10 | security | cross-site simple POST (`text/plain`, `Origin: http://evil.example`) to /api/settings | rejected; settings unchanged | Y | server_test.go |
| SRV-11 | security | cross-site simple POST to /api/quit | rejected; show keeps running | Y | server_test.go |
| SRV-12 | security | request with foreign `Host:` header (DNS rebinding) | rejected | Y | server_test.go |
| SRV-13 | robustness | media folder deleted while running | /api/media 200 with empty lists; /media/x 404 | Y | server_test.go |

### 4.3 Browser launch and camera permission: `browser_test.go`, `browser_extra_test.go`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| CAM-00a | allowCamera | existing Preferences, call twice (existing test) | prefs kept; camera allowed | Y | browser_test.go |
| CAM-00b | allowCamera | broken JSON Preferences (existing test) | error; file untouched | Y | browser_test.go |
| CAM-01 | allowCamera | no profile yet | profile created; setting 1; `last_modified` is now in µs since 1601 | Y | browser_extra_test.go |
| CAM-02 | allowCamera | other sites' camera/mic exceptions, unrelated prefs, big integers | all kept; app origin allowed; large integer not rewritten in float form | Y | browser_extra_test.go |
| CAM-03 | allowCamera | second call | file not rewritten (bytes and mtime equal) | Y | browser_extra_test.go |
| CAM-04 | allowCamera | origin previously blocked (2); a new port | both allowed | Y | browser_extra_test.go |
| CAM-05 | allowCamera | Preferences = `[]`, `null`, `"x"`, empty, truncated, `{"profile":null}`, wrong types | never panics; non-objects left untouched with an error; objects repaired | Y | browser_extra_test.go |
| CAM-06 | allowCamera | Preferences is a directory | error | Y | browser_extra_test.go |
| BR-01 | openBrowser | kiosk with a Chrome path (fake script records args) | `--kiosk`, profile dir, autoplay, throttling flags; no Edge-only flag; URL last; camera pre-allowed | Y | browser_extra_test.go |
| BR-02 | openBrowser | kiosk with an Edge path | plain `--kiosk`, no `--edge-kiosk-type=fullscreen` (InPrivate ignores the pre-allowed camera) | Y | browser_extra_test.go |
| BR-03 | openBrowser | windowed / setup | `--app=<url>`, window size, no `--kiosk` | Y | browser_extra_test.go |
| BR-04 | openBrowser | missing executable | error returned | Y | browser_extra_test.go |
| BR-05 | findBrowser | Edge and Chrome both on PATH (Linux branch) | Edge preferred, isEdge = true | Y | browser_extra_test.go |

### 4.4 Settings: `test/unit/settings.test.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| SE-01 | deepMerge | partial saved settings | changed key applied; all other defaults kept | Y | settings.test.mjs |
| SE-02 | deepMerge | settings from an older version | missing sections and keys filled in | Y | settings.test.mjs |
| SE-03 | deepMerge | unknown extra keys | preserved | Y | settings.test.mjs |
| SE-04 | deepMerge | arrays (calibration points) | replaced, not merged | Y | settings.test.mjs |
| SE-05 | deepMerge | garbage top level (null, [], string, number, bool) | defaults | Y | settings.test.mjs |
| SE-06 | deepMerge | a section is null / array / string | that section's defaults | Y | settings.test.mjs |
| SE-07 | deepMerge | wrong-typed leaf values (`"long"`, null, `"0.7"`, `{}`) | fall back to the default type | Y | settings.test.mjs |
| SE-08 | deepMerge | mutate the merged result | DEFAULTS unchanged | Y | settings.test.mjs |
| SE-09 | defaults | sanity | lines ordered, jar inside the picture, strobe off by default | Y | settings.test.mjs |
| SE-10 | defaults | phrase lists | one non-empty list per stage/audience | Y | settings.test.mjs |
| SE-11 | load | nothing saved anywhere | defaults; firstRun = true | Y | settings.test.mjs |
| SE-12 | load | settings.json and localStorage both present | settings.json wins; firstRun = false | Y | settings.test.mjs |
| SE-13 | load | launcher returns `{}` | localStorage backup used | Y | settings.test.mjs |
| SE-14 | load | fetch throws (no launcher) | localStorage backup used | Y | settings.test.mjs |
| SE-15 | load | HTTP 500 | localStorage backup used | Y | settings.test.mjs |
| SE-16 | load | corrupt settings.json body | falls back, no throw | Y | settings.test.mjs |
| SE-17 | load | corrupt localStorage | defaults, firstRun | Y | settings.test.mjs |
| SE-18 | load | localStorage throws | defaults, no throw | Y | settings.test.mjs |
| SE-19 | load | missing / non-array phrase lists | filled from defaults; user lists kept | Y | settings.test.mjs |
| SE-20 | load | phrase list deliberately emptied by the user | stays empty after restart (same as before restart) | Y | settings.test.mjs |
| SE-21 | load | filled lists are copies | DEFAULT_PHRASES not mutated | Y | settings.test.mjs |
| SE-22 | load | 20,000-line phrase list | kept | Y | settings.test.mjs |
| SE-23 | load | `calibration.points` is an object | `new Tracker(s)` does not throw (app must boot) | Y | settings.test.mjs |
| SE-24 | load | `timing.scareMs = "6.5 s"` | the scare still ends | Y | settings.test.mjs |
| SE-25 | save | normal save | POST full settings + localStorage backup | Y | settings.test.mjs |
| SE-26 | save | launcher error | `ok:false`, "browser only", backup written | Y | settings.test.mjs |
| SE-27 | save | localStorage quota error | settings.json still written | Y | settings.test.mjs |
| SE-28 | save | save then load | identical settings | Y | settings.test.mjs |
| SE-29 | replace | replaceSettings | same object identity, deep copy | Y | settings.test.mjs |
| SE-30 | replace | Director built on the shared object | sees replaced values | Y | settings.test.mjs |

### 4.5 Tracker: `test/unit/tracker.test.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| TR-01 | height model | 0 calibration points | estimated from cameraHeight/horizon | Y | tracker.test.mjs |
| TR-02 | height model | cameraHeight 0 / negative | clamped to 0.2 m, finite | Y | tracker.test.mjs |
| TR-03 | height model | 1 point | reproduces that point exactly | Y | tracker.test.mjs |
| TR-04 | height model | 1 point above the horizon | rejected, estimated model | Y | tracker.test.mjs |
| TR-05 | height model | 3 exact points | least squares recovers a, b | Y | tracker.test.mjs |
| TR-06 | height model | degenerate points (same footY) | falls back to the 1-point model | Y | tracker.test.mjs |
| TR-07 | height model | slope <= 0.05 | rejected, positive fallback | Y | tracker.test.mjs |
| TR-08 | height model | zero / negative / NaN values | ignored, never NaN | Y | tracker.test.mjs |
| TR-09 | height model | `points` missing | estimated | Y | tracker.test.mjs |
| TR-10 | height | 0.95-1.85 m people at several distances (calibrated) | within 3 % | Y | tracker.test.mjs |
| TR-11 | kid/adult | 1.1 / 1.38 / 1.45 / 1.8 m; childMaxHeight changed | kid if strictly shorter; setting honoured | Y | tracker.test.mjs |
| TR-12 | kid/adult | never seen head to toe | height null, isKid null | Y | tracker.test.mjs |
| TR-13 | height | 3.0 m / 0.3 m boxes | discarded | Y | tracker.test.mjs |
| TR-14 | height | 40 frames with one outlier | median of at most 25 samples, robust | Y | tracker.test.mjs |
| TR-15 | height | one detection, then 1 s of missed detections | still exactly 1 height sample (stale box not re-measured) | Y | tracker.test.mjs |
| TR-16 | ground | feet visible / at >= 0.97 | groundY = bottom; >= 0.97 = out of frame | Y | tracker.test.mjs |
| TR-17 | ground | feet below the picture, camera above head height | groundY extrapolated to the true foot position (± 0.02) | Y | tracker.test.mjs |
| TR-18 | zones | scare line at 120 % | 110 % gives near, 130 % gives scare | Y | tracker.test.mjs |
| TR-19 | ground | head and feet cut off | groundY >= 1.1, level 3 | Y | tracker.test.mjs |
| TR-20 | zones | exactly on and just above each line | 0/1/2/3 with inclusive thresholds | Y | tracker.test.mjs |
| TR-21 | zones | left/right limits | outside gives level 0, inArea false; limits inclusive | Y | tracker.test.mjs |
| TR-22 | zones | near line dragged above the approach line | feet above the approach line (street) stay level 0 | Y | tracker.test.mjs |
| TR-23 | zones | left limit > right limit | handled (not "nobody ever in area") | Y | tracker.test.mjs |
| TR-24 | tracking | one walking person, 20 frames | one stable ID | Y | tracker.test.mjs |
| TR-25 | tracking | two people side by side, detector order alternates | two stable IDs | Y | tracker.test.mjs |
| TR-26 | tracking | two people crossing paths | IDs not swapped | Y | tracker.test.mjs |
| TR-27 | tracking | big jump | new track | Y | tracker.test.mjs |
| TR-28 | expiry | gaps of 1.0 / 1.15 / 1.999 / 2.0 s | fresh < 1.1 s; kept < 2 s; removed at 2 s; return gives a new ID | Y | tracker.test.mjs |
| TR-29 | confirm | confirmMs 700 / 0 | needs time AND >= 2 detections | Y | tracker.test.mjs |
| TR-30 | motion | motion-only boxes | no height, unknown audience, level still computed | Y | tracker.test.mjs |
| TR-31 | model | refreshModel after calibration | new model used | Y | tracker.test.mjs |
| TR-32 | edge | empty input | no-op | Y | tracker.test.mjs |

### 4.6 Director (state machine): `test/unit/director.test.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| DI-01 | init | new Director | idle, kids, armed, no hold | Y | director.test.mjs |
| DI-02 | idle | nobody / unconfirmed / stale / outside / beyond approach line | stays idle | Y | director.test.mjs |
| DI-03 | idle->approach | confirmed visitor at level 1 | approach, "visitor arrived", audience decided | Y | director.test.mjs |
| DI-04 | idle->near | first seen at level 2 | near directly | Y | director.test.mjs |
| DI-05 | approach->near | level 2 before / after minStageMs | waits for minStageMs | Y | director.test.mjs |
| DI-06 | near->scare | level 3, scareDelayMs 500 | scare after the delay; disarmed | Y | director.test.mjs |
| DI-07 | scare delay | scareDelayMs 0 | immediate | Y | director.test.mjs |
| DI-08 | approach->scare | very fast walker | scare without near | Y | director.test.mjs |
| DI-09 | scare length | scareMs | goodbye after scareMs | Y | director.test.mjs |
| DI-10 | scare length | custom sceneLength 9 s | overrides scareMs; reset afterwards | Y | director.test.mjs |
| DI-11 | goodbye->idle | nobody left | idle after goodbyeMs | Y | director.test.mjs |
| DI-12 | goodbye->near/approach | still there at level 2 / 1 | near / approach, "still here" | Y | director.test.mjs |
| DI-13 | empty timeout | empty for emptyMs | goodbye exactly after emptyMs | Y | director.test.mjs |
| DI-14 | empty timeout | repeated 2 s gaps | visit continues | Y | director.test.mjs |
| DI-15 | multiple | two visitors, one leaves | continues; level = closest | Y | director.test.mjs |
| DI-16 | eyes | primary target | closest person | Y | director.test.mjs |
| DI-17 | triggers | triggerOnClose off | level 3 does not scare | Y | director.test.mjs |
| DI-18 | triggers | jar motion over sensitivity | scare, "grabbed a treat" | Y | director.test.mjs |
| DI-19 | triggers | jar motion below sensitivity | no scare | Y | director.test.mjs |
| DI-20 | triggers | hand inside / outside the jar box | scare only inside | Y | director.test.mjs |
| DI-21 | triggers | triggerOnGrab off | motion and hands ignored | Y | director.test.mjs |
| DI-22 | triggers | jar disabled | motion and hands ignored | Y | director.test.mjs |
| DI-23 | triggers | jar motion with nobody around | no grab | Y | director.test.mjs |
| DI-24 | kids scare off | kid at level 3 + jar motion | never scared; goodbye on leaving | Y | director.test.mjs |
| DI-25 | kids scare off | adult | still scared | Y | director.test.mjs |
| DI-26 | kids scare off | kid joins adults while a scare is pending | pending scare cancelled (no kids scare) | Y | director.test.mjs |
| DI-27 | arming | same group stays after goodbye | no second scare before rearmMs | Y | director.test.mjs |
| DI-28 | arming | rearmMs passes with the group still there | scare again | Y | director.test.mjs |
| DI-29 | arming | empty for 2.5 s | armed; next group scared at once | Y | director.test.mjs |
| DI-30 | audience | mode kids / adults | overrides heights | Y | director.test.mjs |
| DI-31 | audience | mixed, rule kids | kids | Y | director.test.mjs |
| DI-32 | audience | mixed, rule majority (2:1, 1:1) | adults; tie gives kids | Y | director.test.mjs |
| DI-33 | audience | unknown heights | audience.unsure | Y | director.test.mjs |
| DI-34 | audience | known + unknown | unknown ignored | Y | director.test.mjs |
| DI-35 | audience | stable change | switches after 1.2 s; onAudience fired once | Y | director.test.mjs |
| DI-36 | audience | flickering kid/adult every 0.5 s | never switches | Y | director.test.mjs |
| DI-37 | audience | change during scare | no switch | Y | director.test.mjs |
| DI-38 | audience | adult detected a moment before the child (mixed, rule kids) | the adult version never plays | Y | director.test.mjs |
| DI-39 | preview | force(near) with visitors and grabs | held: no change, no scare, no goodbye | Y | director.test.mjs |
| DI-40 | preview | force(idle) | held until resumeAuto, then reacts | Y | director.test.mjs |
| DI-41 | preview | force(scare) | plays once, then goodbye and idle automatically | Y | director.test.mjs |
| DI-42 | preview | force with audience null | keeps the audience | Y | director.test.mjs |
| DI-43 | preview | resumeAuto | idle, reason "resume" | Y | director.test.mjs |
| DI-44 | preview | info while held | counts updated | Y | director.test.mjs |
| DI-45 | preview | forced scare + custom length | not cut short | Y | director.test.mjs |
| DI-46 | extremes | all timings 0, flapping presence | no runaway loop / throw | Y | director.test.mjs |
| DI-47 | testability | update(now) on a different clock from performance.now() | stage timing still correct (documents T1) | Y | director.test.mjs |
| DI-48 | integration | calibrated 1.15 m child walking (Tracker + Director) | approach(kids) ... scare(kids), no adult scenes | Y | director.test.mjs |

### 4.7 Media chooser: `test/unit/media.test.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| ME-01 | folders | folderFor | idle, `<stage>-<audience>` | Y | media.test.mjs |
| ME-02 | consistency | JS folders vs Go `mediaFolders` vs phrase keys | identical sets | Y | media.test.mjs |
| ME-03 | consistency | every Go `mediaExts` entry (any case) | classified as video/image/audio by media.js | Y | media.test.mjs |
| ME-04 | chooser | builtin | never a file | Y | media.test.mjs |
| ME-05 | chooser | custom + empty / missing folder | built-in fallback | Y | media.test.mjs |
| ME-06 | chooser | custom | one visual + one audio from the right audience folder | Y | media.test.mjs |
| ME-07 | chooser | only sounds | built-in visual + sound | Y | media.test.mjs |
| ME-08 | chooser | random choice | every file reachable | Y | media.test.mjs |
| ME-09 | chooser | mix | about 50 % custom | Y | media.test.mjs |
| ME-10 | chooser | missing mode | builtin | Y | media.test.mjs |
| ME-11 | count | escaped names, upper-case | split correctly | Y | media.test.mjs |
| ME-12 | refresh | network error | `{}` without throwing | Y | media.test.mjs |

### 4.8 Start-up and camera: `test/browser/boot.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| BO-01 | boot | fake camera, seeded settings | loading gone, AI mode, idle drawn, setup closed, no console errors | Y | boot.mjs |
| BO-02 | first run | no settings anywhere | setup opens with "first start" welcome | Y | boot.mjs |
| BO-03 | boot | `?setup=1` | setup open, no welcome | Y | boot.mjs |
| BO-04 | camera denied | getUserMedia rejects NotAllowedError | message + toast; all 9 scenes previewable and visible; scare, goodbye, idle run on timers; no other errors | Y | boot.mjs |
| BO-05 | no camera | no video device | same as BO-04 | Y | boot.mjs |
| BO-06 | late camera | first getUserMedia fails (USB not ready / in use), later ones work | app retries and detection starts | Y | boot.mjs |
| BO-07 | corrupt settings | invalid JSON in settings.json | boots with defaults | Y | boot.mjs |
| BO-08 | bad types | `calibration.points = {}` | still boots | Y | boot.mjs |
| BO-09 | no launcher | /api/settings unreachable | localStorage settings used; Save says "browser only" | Y | boot.mjs |
| BO-10 | AI fallback | model file fails to load | motion mode, toast; show still reacts to movement | Y | boot.mjs |
| BO-11 | AI fallback | AI fails, motion fallback off | runs in mode none, no errors | Y | boot.mjs |
| BO-12 | disk | plain start | no settings.json until Save; Save writes the full settings | Y | boot.mjs |

### 4.9 Setup screen: `test/browser/setup.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| SU-01 | open/close | S, S, Shift+S, Esc, Close button | toggles correctly | Y | setup.mjs |
| SU-02 | tabs | click all 10 tabs | each renders real content (no `[object ...]`/undefined/NaN), no errors | Y | setup.mjs |
| SU-03 | status | live status box | stage, audience, detection mode shown | Y | setup.mjs |
| SU-04 | sliders | approach line, scare length, detections/s | live settings and displayed value change; "Unsaved changes" | Y | setup.mjs |
| SU-05 | save | Save | settings.json has the new values; "Saved" | Y | setup.mjs |
| SU-06 | undo | change, then Undo | values and slider UI restored | Y | setup.mjs |
| SU-07 | zones | drag the near line and the jar box on the camera picture | values follow the mouse; slider updated | Y | setup.mjs |
| SU-08 | reset | Reset to defaults + confirm, then Save | defaults restored, marked unsaved, saved | Y | setup.mjs |
| SU-09 | reset | Reset cancelled | nothing changes | Y | setup.mjs |
| SU-10 | phrases | Phrases tab | 9 editable text boxes; editing updates the phrase lists; typing letters/digits does not trigger shortcuts | Y | setup.mjs |
| SU-10b | keys | S/M/D/digits while a slider has focus; Esc | no shortcut fires; Esc closes | Y | setup.mjs |
| SU-11 | close | close with unsaved changes | warning toast | Y | setup.mjs |
| SU-12 | test tab | preview buttons, Back to automatic | held preview + PREVIEW marker; resume to idle | Y | setup.mjs |
| SU-13 | sound tab | all test sound/voice buttons | no errors | Y | setup.mjs |
| SU-14 | media tab | counts and folder path; Re-scan | shown | Y | setup.mjs |
| SU-15 | calibration | Capture twice with one head-to-toe person; Remove last; Clear all | points added; model "1 point", then "calibrated"; removal works | Y | setup.mjs |
| SU-16 | exit | Advanced > Exit app + confirm | launcher exits 0; "Stopped" shown | Y | setup.mjs |
| SU-17 | zones | scare line set to 120 %, drag it from the bottom edge | the line can be grabbed and moved | Y | setup.mjs |

### 4.10 Keyboard shortcuts: `test/browser/keys.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| KE-01 | keys | 1-9 | right stage, audience and hold flag for each key | Y | keys.mjs |
| KE-02 | keys | 1 after 7; then 0 | keeps adults; 0 gives idle, hold off, toast | Y | keys.mjs |
| KE-03 | keys | M, M | master gain 0 + "Muted", then restored | Y | keys.mjs |
| KE-04 | keys | D, D | camera inset shown with picture, then hidden | Y | keys.mjs |
| KE-05 | keys | F, F | no errors | Y | keys.mjs |
| KE-06 | keys | arrows, space, Enter, other letters | nothing happens | Y | keys.mjs |
| KE-07 | usability | preview hold (key 3) | visible hint on the show screen that automatic mode is paused | Y | keys.mjs |

### 4.11 Custom media, speech, subtitles: `test/browser/media.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| MD-01 | listing | /api/media with odd names; counts | escaped URLs; counts correct | Y | media.mjs |
| MD-02 | video | 4 s H.264 scare video (custom), scareMs 15 s | plays; sceneLength ~4300 ms; built-in music stopped; goodbye after ~4.3 s | Y | media.mjs |
| MD-03 | video | WebM named `my vid #1 100% ünï.webm` | plays without error | Y | media.mjs |
| MD-04 | image | custom PNG for kids near | shown full screen, video hidden | Y | media.mjs |
| MD-05 | fallback | custom mode, empty folder | built-in scene | Y | media.mjs |
| MD-06 | audio | idle custom with only a WAV | built-in animation; WAV played; no speech synthesis | Y | media.mjs |
| MD-07 | subtitles | built-in scene talks | subtitle text is one of the phrases | Y | media.mjs |
| MD-08 | subtitles | subtitles off | no subtitle | Y | media.mjs |
| MD-09 | modes | builtin ignores files; mix about half | as stated | Y | media.mjs |
| MD-10 | fallback | broken `.mp4` (random bytes) | built-in scene instead of a black screen | Y | media.mjs |
| MD-11 | video | 20 s goodbye video | goodbye still ends after goodbyeMs; video removed | Y | media.mjs |
| MD-12 | mute | M, then a talking scene | speech silent (volume 0 or not spoken) | Y | media.mjs |
| MD-13 | mute | M, then a custom video | video muted | Y | media.mjs |
| MD-14 | leak | custom video over kids welcome for 10 s | built-in particles do not accumulate | Y | media.mjs |
| MD-15 | errors | whole run | no console errors except the broken file | Y | media.mjs |

### 4.12 Scenes, resize, flashing: `test/browser/scenes.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| SC-01 | scenes | off-screen simulation of all 9 scenes; adult scare mild/medium/max, max with and without strobe, 10-40 s each | no exceptions; mostly non-blank; < 1500 particles | Y | scenes.mjs |
| SC-02 | scenes | unknown stage name | invite scene, no crash | Y | scenes.mjs |
| SC-03 | safety | strobe OFF, all scare levels + kids scenes, 60 fps luminance analysis | <= 3 general flashes in any second (WCAG 2.3.1-style) | Y | scenes.mjs |
| SC-04 | safety | strobe ON | flashes > 3/s (the warning is accurate) | Y | scenes.mjs |
| SC-05 | scenes | live preview of all 9 scenes | frames change; no errors | Y | scenes.mjs |
| SC-06 | resize | 1920x1080, 1080x1920, 3840x1080, 320x240, 4K, 1366x768 | canvas height = quality; aspect matches the window; drawn; no errors | Y | scenes.mjs |
| SC-07 | quality | low / high / medium | 540 / 1080 / 720 px render height | Y | scenes.mjs |

### 4.13 Robustness: `test/browser/robustness.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| RB-01 | stall | visitor present, then the detector stops delivering results | goodbye/idle after emptyMs + goodbyeMs (no freeze) | Y | robustness.mjs |
| RB-02 | stall | detection worker terminated | detected/restarted; no freeze | Y | robustness.mjs |
| RB-03 | camera | camera track ends mid-show (unplugged) | message or reconnect attempt | Y | robustness.mjs |
| RB-04 | extremes | detections/s = 1 with the adult video | approach and adult scare still happen; no errors | Y | robustness.mjs |
| RB-05 | extremes | all timing sliders at minimum, 15 detections/s | < 40 stage changes in 30 s; no errors | Y | robustness.mjs |
| RB-06 | big data | 9 x 4500 phrases (~3 MB) | boots; Save < 5 s; file correct | Y | robustness.mjs |
| RB-07 | empty data | every phrase list emptied at runtime | all scenes run; never says "undefined" | Y | robustness.mjs |
| RB-08 | false trigger | adult walks up past the default jar box, no hand (scare line disabled at 150 %) | no "grabbed a treat" scare | Y | robustness.mjs |
| RB-09 | zones | visitor outside the left/right limits | show does not react | Y | robustness.mjs |

### 4.14 Performance and soak: `test/browser/perf.mjs`, `test/browser/soak.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| PF-01 | perf | 150 frames per scene at 1920x1080 / medium | average < 16 ms per frame (reports avg/p95) | Y | perf.mjs |
| PF-02 | perf | live with detection and a visitor | >= 30 fps drawing, >= 3 detections/s; long tasks reported | Y | perf.mjs |
| PF-03 | perf | setup open | >= 30 fps | Y | perf.mjs |
| SK-01 | soak | SOAK_MIN minutes: real detection on the looping video, random previews, auto periods, setup open/close, mix-mode custom media | no errors; heap growth < 30 MB; DOM growth < 50; particles, tracks and music nodes bounded; fps >= 25 | Y (SOAK=1) | soak.mjs |

### 4.15 End to end (fake camera videos): `test/e2e.mjs`

| ID | Area | Test case / steps | Expected result | Auto | File |
|---|---|---|---|---|---|
| E2E-01 | e2e | `approach.y4m` (adult walks up and leaves) | AI running; approach/near, scare, goodbye, idle in order; adult welcome and adult scare; no kids scenes; no errors | Y | e2e.mjs `--expect adults` |
| E2E-02 | e2e | `child.y4m` (same walk, x0.62) | same sequence, kids audience throughout | Y | e2e.mjs `--expect kids` |
| E2E-03 | e2e | `group.y4m` (adult + child together, mixed = kids) | kids audience throughout (no adult welcome) | Y | e2e.mjs `--expect kids` |

## 5. Traceability to the requested coverage

| Requirement | Cases |
|---|---|
| settings round trip, invalid JSON, atomic write | API-01..10, SRV-09 |
| media listing, odd names, unsupported extensions | API-15..18, SRV-03, MD-01, ME-02/03 |
| path traversal | SRV-04 |
| quit only via POST | SRV-05, SU-16 |
| MIME .js/.mjs/.cjs/.wasm/.css | SRV-02 |
| port in use | SRV-06..08 |
| data dir, media folders and README | SRV-01, API-11..14 |
| allowCamera merge / idempotent / broken | CAM-00a..06 |
| deepMerge, phrases, firstRun, localStorage | SE-01..30, BO-02, BO-07..09 |
| tracker model, kid/adult, feet extrapolation, limits, levels, IDs, expiry, motion | TR-01..32 |
| director transitions, timers, arming, triggers, audience, preview | DI-01..48 |
| media chooser | ME-04..12, MD-02..11 |
| browser boot, camera denied/none, scenes, setup, keys, custom media, subtitles, resize | BO-*, SU-*, KE-*, MD-*, SC-* |
| soak and performance | SK-01, PF-01..03 |
| e2e adult/child | E2E-01..03 |
| robustness (corrupt settings, huge/empty phrases, extremes, odd line order) | BO-07/08, RB-04..07, TR-22/23, SE-07/23/24 |

## 6. Manual tests (cannot be automated here)

| ID | Area | Test case | Expected result | Auto |
|---|---|---|---|---|
| M-01 | Windows | double-click `SpookyTreatStation.exe` on Windows 10/11 with Edge | Edge opens full screen in kiosk mode, no camera prompt, sound plays without a click | N |
| M-02 | Windows | `Setup Mode.bat` | windowed app with setup open | N |
| M-03 | Windows | `Start with Windows - ON/OFF.bat`, including an install path with spaces and an apostrophe (`C:\Users\O'Brien\...`) | shortcut created / removed; show starts after sign-in | N |
| M-04 | Windows | leave running 1 h with no input | screen and PC stay awake (SetThreadExecutionState) | N |
| M-05 | camera | real USB webcam at night with porch light; adults, kids, costumes, groups | detection, kid/adult and scare behave as in E2E | N |
| M-06 | camera | unplug and replug the webcam during the show | (see RB-03) recovers without a reload | N |
| M-07 | camera | Windows boots with the webcam enumerated late (autostart) | (see BO-06) detection starts | N |
| M-08 | GPU | Advanced > GPU on, Intel iGPU driver | people still detected or a clear fallback | N |
| M-09 | voices | Windows voices: offline voice list, friendly/scary selection, Edge "Online" voices with allowOnlineVoices off | only local voices used offline | N |
| M-10 | perf | Celeron N4020 / 8 GB, 1080p TV, quality medium | >= 30 fps drawing; >= 3 detections/s | N |
| M-11 | media | H.264 MP4 with AAC, MOV (HEVC), OGV in Edge | plays, or falls back (see MD-10) | N |
| M-12 | power | pull the plug during Save, then restart | settings.json is the old or the new version, never corrupt | N |
| M-13 | kiosk | Alt+F4, Esc, F11 in Edge kiosk | documented behaviour; console window closes the server | N |

## Addendum v1.0.3: live updates, natural voices, camera format

| ID | Area | Description | Expected result | Automated | File |
|---|---|---|---|---|---|
| API-20 | Launcher | `/api/state` settingsRev changes on every save; save response carries the rev | rev differs after each save | Y | api_test.go |
| API-21 | Launcher | mediaRev changes when a media file is added; pageActive follows polling | changes / true after a poll | Y | api_test.go |
| API-22 | Launcher | `/api/open-setup` is POST only and bumps the counter in `/api/state` | 405 for GET; counter 1 | Y | api_test.go |
| LV-01 | Live | settings saved from another window apply to the running show | applied within ~2 s, toast | Y | test/browser/live.mjs |
| LV-02 | Live | hand-edited settings.json is picked up | applied | Y | live.mjs |
| LV-03 | Live | own save does not reload/replay itself | scene unchanged, "no restart needed" | Y | live.mjs |
| LV-04 | Live | closing setup after changes restarts the current scene; without changes it doesn't | replay only after changes | Y | live.mjs |
| LV-05 | Live | small camera view / hide pointer apply immediately | instant | Y | live.mjs |
| LV-06 | Live | external save while setup has unsaved edits doesn't overwrite them; Undo loads disk | edits kept, Undo loads saved | Y | live.mjs |
| LV-07 | Live | new media file noticed without restart or Re-scan | listed within ~2 s | Y | live.mjs |
| LV-08 | Live | GPU option switch restarts detection live | new worker, detections continue | Y | live.mjs |
| LV-09 | Launcher | second start while showing doesn't open a second show | message, no browser | Y | live.mjs |
| LV-10 | Launcher | "Setup Mode" while showing opens setup on the running show | setup opens | Y | live.mjs |
| LV-11 | Launcher | server running but no page open: second start opens the browser | browser opened | Y | live.mjs |
| TTS-01 | Voices | without Piper: status unavailable with reason; synth 503 | as expected | Y | tts_test.go |
| TTS-02 | Voices | generate once (miss) then cached (hit, <200 ms); checkOnly ready false/true; other speaker differs | as expected | Y | tts_test.go |
| TTS-03 | Voices | invalid voice (incl. path-like), speaker range, empty/long text, speed, bad JSON, GET | 400 / 405 | Y | tts_test.go |
| TTS-04 | Voices | 4 simultaneous requests for one new phrase | all 200, generated once, no temp files left | Y | tts_test.go |
| TTS-05 | Voices | Piper process killed: next request recovers | 200 | Y | tts_test.go |
| VO-01 | Voices | natural voices detected; all phrases prepared in background | 10/10 ready, files in voice-cache | Y | test/browser/voices.mjs |
| VO-02 | Voices | natural speech: subtitles, mouth follows loudness, ends cleanly | engine natural | Y | voices.mjs |
| VO-03 | Voices | all four character effects play without errors | 4 × natural | Y | voices.mjs |
| VO-04 | Voices | not-yet-generated phrase falls back to Windows voice, next time natural | windows then natural | Y | voices.mjs |
| VO-05 | Voices | setup Sound tab: status, per-character speaker/Try/Another voice; changed voice re-prepares phrases | as expected | Y | voices.mjs |
| VO-06 | Voices | engine "Windows only" never requests natural voices | 0 requests | Y | voices.mjs |
| VO-07 | Voices | mute → subtitles only; stop() cuts a phrase | as expected | Y | voices.mjs |
| VO-08 | Voices | scenes use natural voices during a visit | natural playback | Y | voices.mjs |
| VO-09 | Camera | Camera picture option switches 640×480 ↔ 1280×720 with recalibration reminder | as expected | Y | voices.mjs |
| VO-10 | Voices | without Piper: setup explains, Windows voices used, no errors | as expected | Y | voices.mjs |
| VO-M1 | Voices | voice levels: no clipping, characters balanced (rendered offline with the app's effect code) | peaks ≤ −3 dB; means within ~4 dB | manual (measured) | docs/voice-samples |
| CAM-M1 | Camera | physical placement on the real C270 at the door | head-to-toe from ~3 m | manual (user) | README |

## Addendum v1.1.0: Linux version

| ID | Area | Description | Expected result | Automated | File |
|---|---|---|---|---|---|
| LX-01 | Launcher | Linux browser order: Chrome preferred over Chromium | google-chrome chosen | Y | browser_test.go |
| LX-02 | Launcher | no browser on Linux: error explains the Chrome install commands + install.sh | message contains apt command | Y | browser_test.go |
| LP-01 | Package | tar.gz contains program, Piper, voice, scripts, licenses, icon; exec bits kept; no pkgconfig | all present | Y | test/linux-package.sh |
| LP-02 | Package | Linux text files use LF line endings | no CRLF | Y | linux-package.sh |
| LP-03 | Package | program is a static x86-64 ELF | runs on any distro | Y | linux-package.sh |
| LP-04 | install.sh | without a browser: explains Chrome install and continues | help + icons added | Y | linux-package.sh |
| LP-05 | install.sh | menu + desktop icons with quoted path (folder name with a space), icon, working dir | correct .desktop files | Y | linux-package.sh |
| LP-06 | install.sh | .desktop files pass desktop-file-validate (when the tool exists) | valid | Y (if tool present) | linux-package.sh |
| LP-07 | install.sh | finds an installed browser | prints it | Y | linux-package.sh |
| LP-08 | start.sh | starts server, opens browser in kiosk with private profile | kiosk args | Y | linux-package.sh |
| LP-09 | start.sh | camera pre-allowed in the private profile | exception written | Y | linux-package.sh |
| LP-10 | Voices | bundled Piper + voice found next to the program | available | Y | linux-package.sh |
| LP-11 | Voices | packaged Piper generates speech on Linux | WAV, cached | Y | linux-package.sh |
| LP-12 | setup-mode.sh | while running: reuses program, opens setup window | --app=…?setup=1 | Y | linux-package.sh |
| LP-13 | Exit | Exit app stops program + Piper processes | none left | Y | linux-package.sh |
| LP-14 | start.sh | without a browser: explains, still serves the address | message + URL | Y | linux-package.sh |
| LP-15/16 | Autostart | autostart-on adds / autostart-off removes the login entry | as expected | Y | linux-package.sh |
| LP-17 | install.sh --remove | removes menu, desktop, autostart; program untouched | as expected | Y | linux-package.sh |
| LP-18 | Show | packaged Linux program runs the full adult walk-up show | e2e passes | Y | linux-package.sh |
| LP-19 | install.sh | interactive "Install Google Chrome now?" → downloads .deb, sudo apt-get install | install commands run | Y (fake apt/sudo) | linux-package.sh |
| LP-20 | install.sh | answering No installs nothing | no install | Y | linux-package.sh |
| LX-M1 | Sleep | systemd-inhibit blocks sleep on a real desktop; graceful message without systemd | "Sleep: disabled" on desktop | manual (container has no systemd: graceful path verified) | — |
| LX-M2 | Desktop | real Ubuntu/Mint desktop: icons launch, kiosk full screen, real webcam, sound | works | manual (user) | — |
