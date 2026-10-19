#!/usr/bin/env bash
# Render, score, encode and contact-sheet the whole week.
#   build-all.sh            -> all seven
#   build-all.sh day3 day5  -> just those
set -u
cd "$(dirname "$0")"

# scene : number : file slug
SCENES=(
  "day1:01:you-know-this-sound"
  "day2:02:your-whatsapp-in-2003"
  "day3:03:one-chat-one-window"
  "day4:04:pick-your-decade"
  "day5:05:two-messengers-one-list"
  "day6:06:wait-it-has-games"
  "day7:07:free-open-source-no-account"
)

want() { [ $# -eq 0 ] && return 0; for a in "$@"; do [ "$a" = "$1x" ] && return 0; done; return 1; }

for entry in "${SCENES[@]}"; do
  IFS=: read -r NAME NUM SLUG <<< "$entry"
  if [ $# -gt 0 ]; then
    hit=0; for a in "$@"; do [ "$a" = "$NAME" ] && hit=1; done
    [ $hit -eq 1 ] || continue
  fi
  echo "=== $NAME -> $NUM-$SLUG ==="
  node render.mjs "$NAME" 2>&1 | grep -v -E "^frame " || { echo "RENDER FAILED $NAME"; continue; }
  python audio.py "$NAME"    || { echo "AUDIO FAILED $NAME"; continue; }
  bash make.sh "$NAME" "$NUM" "$SLUG" || { echo "ENCODE FAILED $NAME"; continue; }
  bash sheet.sh "$NUM"       || echo "SHEET FAILED $NUM"
done
echo "=== done ==="
