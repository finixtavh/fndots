#!/usr/bin/env bash
# FNWall ""backend"" for aww and mpvpaper.

set -u

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
[[ "$STATE_HOME" == /* ]] || STATE_HOME="$HOME/.local/state"
STATE_DIR="$STATE_HOME/fnwall"
STATE_FILE="$STATE_DIR/current"
WALLPAPER_DIR="$SCRIPT_DIR/wallpapers"

save_state() {
    local file="$1"
    if ! mkdir -p -- "$STATE_DIR" || ! chmod 700 -- "$STATE_DIR"; then
        notify-send "Wallpaper" "Could not create the state directory: $STATE_DIR" -a "Wallpaper" -u normal -t 3500
        return 1
    fi
    local staged
    if ! staged=$(mktemp "$STATE_DIR/.current.XXXXXX"); then
        notify-send "Wallpaper" "Could not stage the current-wallpaper state" -a "Wallpaper" -u normal -t 3500
        return 1
    fi
    if ! chmod 600 -- "$staged" ||
       ! printf '%s\n' "$file" > "$staged" ||
       ! mv -- "$staged" "$STATE_FILE"; then
        rm -f -- "$staged"
        notify-send "Wallpaper" "Could not save the current-wallpaper state" -a "Wallpaper" -u normal -t 3500
        return 1
    fi
    return 0
}

apply_wallpaper() {
    local file="$1"
    local extension="${file##*.}"
    extension="${extension,,}"

    case "$extension" in
        mp4|mkv|webm|avi|mov|m4v)
            pkill -x mpvpaper   2>/dev/null
            pkill -x awww       2>/dev/null
            pkill -x awww-daemon 2>/dev/null
            sleep 0.5

            mpvpaper '*' "$file" -o "--no-audio --loop --hwdec=auto-safe" >/dev/null 2>&1 &
            local video_pid=$!
            disown 2>/dev/null || true
            sleep 0.75
            if ! kill -0 "$video_pid" 2>/dev/null; then
                wait "$video_pid" 2>/dev/null || true
                notify-send "Wallpaper" "mpvpaper could not apply $(basename -- "$file")" -a "Wallpaper" -u normal -t 3500
                return 1
            fi
            ;;

        *)
            pkill -x mpvpaper    2>/dev/null
            pkill -x awww-daemon 2>/dev/null

            if ! pgrep -x awww-daemon > /dev/null; then
                awww-daemon --no-cache >/dev/null 2>&1 &
                local daemon_pid=$!
                disown 2>/dev/null || true
                sleep 0.5
                if ! kill -0 "$daemon_pid" 2>/dev/null; then
                    wait "$daemon_pid" 2>/dev/null || true
                    notify-send "Wallpaper" "awww-daemon could not start" -a "Wallpaper" -u normal -t 3500
                    return 1
                fi
            fi

            if ! awww img "$file"; then
                notify-send "Wallpaper" "awww could not apply $(basename -- "$file")" -a "Wallpaper" -u normal -t 3500
                return 1
            fi
            ;;
    esac

    save_state "$file"
}

selection="${1:-}"
if [[ "$selection" == "--random" ]]; then
    mapfile -d '' -t wallpapers < <(
        find "$WALLPAPER_DIR" -maxdepth 1 -type f \
            \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \
               -o -iname '*.gif' -o -iname '*.bmp' -o -iname '*.webp' \
               -o -iname '*.mp4' -o -iname '*.mkv' -o -iname '*.webm' \
               -o -iname '*.avi' -o -iname '*.mov' -o -iname '*.m4v' \) \
            -print0
    )
    if (( ${#wallpapers[@]} == 0 )); then
        notify-send "Wallpaper" "No wallpapers found in $WALLPAPER_DIR" -a "Wallpaper" -u low -t 2500
        exit 1
    fi
    selection="${wallpapers[RANDOM % ${#wallpapers[@]}]}"
fi

if [[ -z "$selection" || ! -f "$selection" ]]; then
    notify-send "Wallpaper" "No such file: '${selection:-<empty>}'" -a "Wallpaper" -u low -t 2500
    exit 1
fi

apply_wallpaper "$selection"
