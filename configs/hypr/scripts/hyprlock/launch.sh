#!/usr/bin/env bash
# launch

set -uo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

pidof hyprlock >/dev/null 2>&1 && exit 0

umask 077
TMP="${XDG_RUNTIME_DIR:-/tmp}/hyprlock"
[[ "$TMP" == /* ]] || TMP="/tmp/hyprlock"
export TMP
CHROMA_FRAME="$TMP/chroma.pango"
CHROMA_PRESET="${XDG_CONFIG_HOME:-$HOME/.config}/hypr/chroma/fn-dots.toml"
CHROMA_SHADER="${CHROMA_PRESET%.toml}.wgsl"
install -d -m700 "$TMP"

rm -f "$TMP"/art-*.png "$TMP"/dl-* 2>/dev/null

"$SCRIPT_DIR/art.sh" >/dev/null 2>&1 &

PREP=()

ffmpeg -y -f lavfi -i "color=c=black@0.0:s=8x8" \
  -frames:v 1 "$TMP/art-none.png" >/dev/null 2>&1 & PREP+=("$!")

printf '<span foreground="#121212"> </span>' > "$CHROMA_FRAME"
CHROMA_PID=""
find_chroma() {
  local candidate
  for candidate in \
    "$HOME/fn-apps/chroma/target/release/chroma" \
    "$HOME/fn-apps/chroma/target/debug/chroma" \
    "$HOME/.local/bin/chroma" \
    "$HOME/.cargo/bin/chroma"; do
    [[ -x "$candidate" ]] && { printf '%s' "$candidate"; return 0; }
  done
  command -v chroma 2>/dev/null
}

CHROMA_BIN=$(find_chroma)
if [[ -n "$CHROMA_BIN" && -f "$CHROMA_PRESET" && -f "$CHROMA_SHADER" ]]; then
  python3 "$SCRIPT_DIR/chroma.py" "$CHROMA_FRAME" -- \
    "$CHROMA_BIN" \
    --stream 82x29 \
    --stream-format cells \
    --fps 24 \
    --background-color 050505 \
    --custom-shader "$CHROMA_SHADER" \
    -c "$CHROMA_PRESET" &
  CHROMA_PID=$!
fi

wait "${PREP[@]}" 2>/dev/null || true

cleanup() {
  if [[ -n "$CHROMA_PID" ]]; then
    kill "$CHROMA_PID" 2>/dev/null
    wait "$CHROMA_PID" 2>/dev/null
  fi
  hyprctl dispatch 'hl.dsp.submap("reset")' '' >/dev/null 2>&1
  rm -f "$CHROMA_FRAME" "$CHROMA_FRAME.tmp"
}
trap cleanup EXIT

hyprctl dispatch 'hl.dsp.submap("lock")' '' >/dev/null 2>&1

hyprlock "$@"
