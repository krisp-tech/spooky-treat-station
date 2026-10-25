#!/usr/bin/env bash
# Builds test/approach.y4m: a person "walking up the driveway" (getting bigger and lower in the picture),
# then leaving after 17 seconds. Used by test/e2e.mjs as a fake camera.
set -euo pipefail
cd "$(dirname "$0")"
[ -f pose.jpg ] || curl -sSLo pose.jpg https://storage.googleapis.com/mediapipe-assets/pose.jpg
ffmpeg -loglevel error -y -f lavfi -i "color=c=0x303438:s=640x480:r=10:d=26" -loop 1 -framerate 10 -t 26 -i pose.jpg \
  -filter_complex "[1:v]crop=560:440:220:220,scale=w='trunc(iw*(0.22+0.075*t)/2)*2':h=-2:eval=frame[p];[0:v][p]overlay=x='(W-overlay_w)/2':y='H*(0.5+0.05*t)-overlay_h':eval=frame:enable='lt(t,17)'[v]" \
  -map "[v]" -pix_fmt yuv420p approach.y4m
echo "wrote $(pwd)/approach.y4m"
