#!/usr/bin/env bash
# Contact sheet for one finished clip: one frame every 2 s, timecode burnt in and the
# Shorts safe zones drawn as thin red lines (top 120, bottom 350, right 150 px).
# usage: sheet.sh <NN>   ->  docs/promo/shorts/sheet-<NN>.png
set -e
cd "$(dirname "$0")"
NUM="$1"
[ -n "$NUM" ] || { echo "usage: sheet.sh <NN>"; exit 2; }
SRC=$(ls ../"$NUM"-*.mp4 2>/dev/null | head -1)
[ -n "$SRC" ] || { echo "no ../$NUM-*.mp4"; exit 2; }

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")
read -r COLS ROWS < <(python -c "
import math,sys
n = int(math.floor(float('$DUR') / 2)) + 1
cols = 5
print(cols, int(math.ceil(n / cols)))")

SAFE="drawbox=x=0:y=0:w=1080:h=120:color=red@0.55:t=4,\
drawbox=x=0:y=1570:w=1080:h=350:color=red@0.55:t=4,\
drawbox=x=930:y=0:w=150:h=1920:color=red@0.55:t=4"
# drawtext needs an explicit font (fontconfig is not set up on Windows). A drive-less path
# avoids having to escape the colon inside the filter string; it resolves on the current drive.
FONT="${SHEET_FONT:-/Windows/Fonts/arialbd.ttf}"
STAMP="drawtext=fontfile=${FONT}:text='%{pts\\:hms}':x=18:y=18:fontsize=56:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=12"

# select by frame number, not fps=1/2: that keeps every tile on an exact source frame
# (0, 60, 120 … = 0 s, 2 s, 4 s …) and the burnt-in timecode truthful.
ffmpeg -y -hide_banner -loglevel error -i "$SRC" \
  -vf "select='not(mod(n\,60))',${SAFE},${STAMP},setpts=N/TB,scale=330:587,tile=${COLS}x${ROWS}:margin=8:padding=6:color=0x0d1115" \
  -frames:v 1 "../sheet-$NUM.png"
ls -l "../sheet-$NUM.png"
