#!/usr/bin/env bash
# Encode one scene into the finished Short.
#   make.sh <scene> <NN> <slug> [maxrate_kbps]   ->  docs/promo/shorts/<NN>-<slug>.mp4
# The soundtrack is pulled to -15.5 LUFS with a measured gain (ebur128 before and after)
# and capped by a limiter so the true peak stays under -1 dBTP.
set -e
cd "$(dirname "$0")"
NAME="$1"; NUM="$2"; SLUG="$3"; RATE="${4:-3700}"
[ -n "$NAME" ] && [ -n "$NUM" ] && [ -n "$SLUG" ] || { echo "usage: make.sh <scene> <NN> <slug> [kbps]"; exit 2; }
OUT="${OUT_DIR:-out}/$NAME"
DST="../$NUM-$SLUG.mp4"

read -r I TP < <(python loud.py "$OUT/mix.wav")
GAIN=$(python -c "print(round(-15.5 - ($I), 2))")
echo "mix.wav: I=$I LUFS  TP=$TP dBFS  -> gain ${GAIN} dB"

ffmpeg -y -hide_banner -loglevel error -framerate 30 -i "$OUT/frames/f%04d.jpg" -i "$OUT/mix.wav" \
  -filter:a "volume=${GAIN}dB,alimiter=level_in=1:level_out=1:limit=0.79:attack=4:release=60:level=disabled" \
  -c:v libx264 -preset slow -crf 20 -maxrate "${RATE}k" -bufsize "$((RATE*2))k" \
  -pix_fmt yuv420p -profile:v high -level 4.1 -r 30 -g 60 \
  -c:a aac -b:a 128k -ar 44100 -ac 2 -movflags +faststart -shortest "$DST"

read -r FI FTP < <(python loud.py "$DST")
SIZE=$(python -c "import os;print(round(os.path.getsize(r'$DST')/1048576,2))")
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$DST")
printf '%s  %.2f s  %s MB  I=%s LUFS  TP=%s dBTP\n' "$NUM-$SLUG.mp4" "$DUR" "$SIZE" "$FI" "$FTP"
