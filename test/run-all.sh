#!/usr/bin/env bash
# Spooky Treat Station - full validation run.
#   bash test/run-all.sh            # Go + unit + browser + end-to-end (~11 min)
#   SOAK=1 SOAK_MIN=5 bash test/run-all.sh   # also the long-running soak test
#   QUICK=1 bash test/run-all.sh    # only Go + unit tests
# Logs and the test binary go to test/out/validation/ (gitignored). Exit code 0 only if everything passed.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT="$ROOT/test/out/validation"
mkdir -p "$OUT"
export PATH="$PATH:/usr/local/go/bin"
BIN="$OUT/sts"
declare -a NAMES PASSES FAILS
add() { NAMES+=("$1"); PASSES+=("$2"); FAILS+=("$3"); }

echo "== building launcher"
if ! go build -o "$BIN" . > "$OUT/build.log" 2>&1; then cat "$OUT/build.log"; echo "BUILD FAILED"; exit 2; fi
export STS_BIN="$BIN"

echo "== test videos"
bash test/make-test-videos.sh > "$OUT/videos.log" 2>&1 || { cat "$OUT/videos.log"; echo "video generation failed"; }

echo "== Piper (natural voices) for tests"
scripts/fetch-voices.sh linux > "$OUT/piper.log" 2>&1 || { tail -3 "$OUT/piper.log"; echo "could not get Piper: natural-voice tests will fail"; }

echo "== Go tests"
go test -count=1 -v . > "$OUT/go.log" 2>&1
gp=$(grep -c -- '^--- PASS' "$OUT/go.log"); gf=$(grep -c -- '^--- FAIL' "$OUT/go.log")
grep -E -- '^--- FAIL|^\s+\S+_test.go:[0-9]+:' "$OUT/go.log" | head -40
add "Go (launcher API, server, browser.go)" "$gp" "$gf"

echo "== Node unit tests"
node --test test/unit/*.test.mjs > "$OUT/unit.log" 2>&1
up=$(grep -E '^# pass' "$OUT/unit.log" | awk '{print $3}'); uf=$(grep -E '^# fail' "$OUT/unit.log" | awk '{print $3}')
grep -E '^not ok' "$OUT/unit.log" | sed 's/^/  /'
add "Unit (tracker, director, settings, media)" "${up:-0}" "${uf:-1}"

run_browser() { # name file
  local name=$1 file=$2 log="$OUT/$(basename "$2" .mjs).log"
  echo "== browser: $name"
  timeout 900 node "$file" "$BIN" > "$log" 2>&1
  local line; line=$(grep -E '^SUMMARY' "$log" | tail -1)
  grep -E '^(FAIL|     )' "$log" | head -30
  if [ -z "$line" ]; then tail -5 "$log"; add "$name" 0 1; return; fi
  local p f; p=$(sed -E 's/.*: ([0-9]+) passed.*/\1/' <<<"$line"); f=$(sed -E 's/.*, ([0-9]+) failed.*/\1/' <<<"$line")
  add "$name" "$p" "$f"
}

run_e2e() { # name video expect port
  local name=$1 log="$OUT/e2e-$3-$(basename "$2" .y4m).log"
  echo "== e2e: $name"
  timeout 300 node test/e2e.mjs "$BIN" "$2" "$OUT/e2e-$(basename "$2" .y4m)" --expect "$3" --port "$4" > "$log" 2>&1
  local line; line=$(grep -E '^E2E' "$log" | tail -1)
  grep -E '^(FAIL|  \[stage\])' "$log" | head -20
  if [ -z "$line" ]; then tail -5 "$log"; add "$name" 0 1; return; fi
  add "$name" "$(sed -E 's/.*: ([0-9]+) passed.*/\1/' <<<"$line")" "$(sed -E 's/.*, ([0-9]+) failed.*/\1/' <<<"$line")"
}

if [ -z "${QUICK:-}" ]; then
  run_browser "Browser: boot / camera / fallback" test/browser/boot.mjs
  run_browser "Browser: setup screen" test/browser/setup.mjs
  run_browser "Browser: keyboard shortcuts" test/browser/keys.mjs
  run_browser "Browser: custom media / speech" test/browser/media.mjs
  run_browser "Browser: scenes / resize / flashing" test/browser/scenes.mjs
  run_browser "Browser: robustness" test/browser/robustness.mjs
  run_browser "Browser: live updates (no restart)" test/browser/live.mjs
  run_browser "Browser: natural voices + camera format" test/browser/voices.mjs
  run_browser "Browser: performance sanity" test/browser/perf.mjs
  echo "== Linux package"
  timeout 1200 bash test/linux-package.sh > "$OUT/linux-package.log" 2>&1
  grep -E '^(FAIL|     )' "$OUT/linux-package.log" | head -30
  lp=$(grep -E '^SUMMARY' "$OUT/linux-package.log" | tail -1)
  if [ -z "$lp" ]; then tail -5 "$OUT/linux-package.log"; add "Linux package (install/start/voices/e2e)" 0 1
  else add "Linux package (install/start/voices/e2e)" "$(sed -E 's/.*: ([0-9]+) passed.*/\1/' <<<"$lp")" "$(sed -E 's/.*, ([0-9]+) failed.*/\1/' <<<"$lp")"; fi
  [ -n "${SOAK:-}" ] && run_browser "Browser: soak (${SOAK_MIN:-3} min)" test/browser/soak.mjs
  run_e2e "E2E: adult walks up (approach.y4m)" test/approach.y4m adults 8811
  run_e2e "E2E: child walks up (child.y4m)" test/child.y4m kids 8812
  run_e2e "E2E: adult + child together (group.y4m)" test/group.y4m kids 8813
fi

echo
echo "================================================================================"
printf "%-48s %7s %7s  %s\n" "SUITE" "PASSED" "FAILED" "RESULT"
echo "--------------------------------------------------------------------------------"
TP=0; TF=0
for i in "${!NAMES[@]}"; do
  r=PASS; [ "${FAILS[$i]}" != "0" ] && r=FAIL
  printf "%-48s %7s %7s  %s\n" "${NAMES[$i]}" "${PASSES[$i]}" "${FAILS[$i]}" "$r"
  TP=$((TP + PASSES[i])); TF=$((TF + FAILS[i]))
done
echo "--------------------------------------------------------------------------------"
printf "%-48s %7s %7s  %s\n" "TOTAL" "$TP" "$TF" "$([ $TF -eq 0 ] && echo PASS || echo FAIL)"
echo "================================================================================"
echo "Logs: $OUT"
[ "$TF" -eq 0 ]
