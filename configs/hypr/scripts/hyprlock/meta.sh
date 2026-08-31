#!/usr/bin/env bash
# meta

escape_pango() {
  local s="$1"
  s="${s//&/&amp;}"
  s="${s//</&lt;}"
  s="${s//>/&gt;}"
  printf '%s' "$s"
}

title=$(playerctl metadata --format '{{title}}' 2>/dev/null)
artist=$(playerctl metadata --format '{{artist}}' 2>/dev/null)
case "${1:-}" in
  title)  escape_pango "${title:0:48}" ;;
  artist) escape_pango "${artist:0:48}" ;;
esac
