#!/usr/bin/env bash
# art

set -uo pipefail

TMP="${XDG_RUNTIME_DIR:-/tmp}/hyprlock"
[[ "$TMP" == /* ]] || TMP="/tmp/hyprlock"
install -d -m700 "$TMP"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
[[ "$CONFIG_HOME" == /* ]] || CONFIG_HOME="$HOME/.config"
[[ "$CACHE_HOME" == /* ]] || CACHE_HOME="$HOME/.cache"

meta() { playerctl metadata --format "{{ $1 }}" 2>/dev/null; }
title=$(meta xesam:title); artist=$(meta xesam:artist)
sig=$(printf '%s|%s' "$title" "$artist" | md5sum | cut -c1-10)
ART="$TMP/art-$sig.png"

resolve_src() {
  local url; url=$(meta mpris:artUrl)
  if [[ "$url" == file://* ]]; then printf '%s' "${url#file://}"; return; fi
  if [[ "$url" == http* ]]; then
    local dl="$TMP/dl-$sig"; curl -sL --max-time 5 --max-filesize 8388608 -o "$dl" "$url" 2>/dev/null && [[ -s "$dl" ]] && { printf '%s' "$dl"; return; }
  fi

  local f
  f=$(ls -t "$CONFIG_HOME/mozilla/firefox/firefox-mpris/"* 2>/dev/null | head -1)
  [[ -n "$f" ]] && { printf '%s' "$f"; return; }
  f=$(ls -t "$CACHE_HOME/ags/art/"*.png 2>/dev/null | head -1)
  [[ -n "$f" ]] && printf '%s' "$f"
}

if [[ ! -f "$ART" ]]; then
  find "$TMP" -maxdepth 1 -name 'art-*.png' ! -name 'art-none.png' -delete 2>/dev/null || true
  src=$(resolve_src)
  if [[ -n "$src" && -f "$src" ]]; then

    ffmpeg -y -i "$src" -vf "scale=1020:1020:force_original_aspect_ratio=increase,crop=1020:1020" "$ART" >/dev/null 2>&1
  fi
fi

[[ -f "$ART" ]] || ART="$TMP/art-none.png"

printf '%s' "$ART"
