#!/usr/bin/env bash
# Builds all fake-camera videos used by the validation suite (all outputs are gitignored: /test/*.y4m).
#   test/approach.y4m  adult-sized person walking up, leaves after 17 s (same as make-test-video.sh)
#   test/child.y4m     same walk, person scaled x0.62 (child-sized), feet on the same ground positions
#   test/group.y4m     adult (left) and child (right) walking up together, leave after 17 s
# Usage: bash test/make-test-videos.sh [--force]
set -euo pipefail
cd "$(dirname "$0")"
FORCE="${1:-}"
[ -f pose.jpg ] || curl -sSLo pose.jpg https://storage.googleapis.com/mediapipe-assets/pose.jpg

if [ ! -f approach.y4m ] || [ "$FORCE" = "--force" ]; then
  bash make-test-video.sh
fi

if [ ! -f child.y4m ] || [ "$FORCE" = "--force" ]; then
  ffmpeg -loglevel error -y -f lavfi -i "color=c=0x303438:s=640x480:r=10:d=26" -loop 1 -framerate 10 -t 26 -i pose.jpg \
    -filter_complex "[1:v]crop=560:440:220:220,scale=w='trunc(iw*(0.22+0.075*t)*0.62/2)*2':h=-2:eval=frame[p];[0:v][p]overlay=x='(W-overlay_w)/2':y='H*(0.5+0.05*t)-overlay_h':eval=frame:enable='lt(t,17)'[v]" \
    -map "[v]" -pix_fmt yuv420p child.y4m
  echo "wrote $(pwd)/child.y4m"
fi

if [ ! -f group.y4m ] || [ "$FORCE" = "--force" ]; then
  ffmpeg -loglevel error -y -f lavfi -i "color=c=0x303438:s=640x480:r=10:d=26" -loop 1 -framerate 10 -t 26 -i pose.jpg \
    -filter_complex "[1:v]crop=560:440:220:220,split=2[a][b];[a]scale=w='trunc(iw*(0.22+0.075*t)/2)*2':h=-2:eval=frame[pa];[b]scale=w='trunc(iw*(0.22+0.075*t)*0.62/2)*2':h=-2:eval=frame[pb];[0:v][pa]overlay=x='W*0.30-overlay_w/2':y='H*(0.5+0.05*t)-overlay_h':eval=frame:enable='lt(t,17)'[v1];[v1][pb]overlay=x='W*0.72-overlay_w/2':y='H*(0.5+0.05*t)-overlay_h':eval=frame:enable='lt(t,17)'[v]" \
    -map "[v]" -pix_fmt yuv420p group.y4m
  echo "wrote $(pwd)/group.y4m"
fi
