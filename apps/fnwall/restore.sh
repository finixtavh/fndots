#!/usr/bin/env bash
# FNWall restore

set -u

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
[[ "$STATE_HOME" == /* ]] || STATE_HOME="$HOME/.local/state"
STATE_FILE="$STATE_HOME/fnwall/current"

[[ -f "$STATE_FILE" ]] || exit 0
wallpaper=$(<"$STATE_FILE")
[[ -f "$wallpaper" ]] || exit 0

exec "$SCRIPT_DIR/wallpicker.sh" "$wallpaper"
