#!/usr/bin/env bash
# screenshot

set -uo pipefail
umask 077

SCREENSHOT_DIR="$(xdg-user-dir PICTURES 2>/dev/null || echo "$HOME/Pictures")/Screenshots"
mkdir -p -m700 "$SCREENSHOT_DIR"
chmod 700 "$SCREENSHOT_DIR"

if pgrep -x slurp >/dev/null 2>&1; then
    exit 0
fi

DATE=$(date '+%Y-%m-%d_%H.%M.%S')
local_file="$SCREENSHOT_DIR/Screenshot_${DATE}.png"

select_region() {
    local geometry
    geometry=$(slurp) || return 1
    [[ -n "$geometry" ]] || return 1
    printf '%s' "$geometry"
}

case "${1:-}" in
    edit)

        if command -v swappy >/dev/null 2>&1; then
            geom=$(select_region) || exit 0
            grim -g "$geom" - | swappy -f -
        else

            geom=$(select_region) || exit 0
            grim -g "$geom" "$local_file" && wl-copy < "$local_file"
            [[ ! -f "$local_file" ]] || chmod 600 "$local_file"
            notify-send "Install swappy to edit screenshots" "sudo pacman -S swappy" -a "Screenshot" -t 6000
        fi
        ;;
    region)

        geom=$(select_region) || exit 0
        grim -g "$geom" "$local_file"
        if [[ -f "$local_file" ]]; then
            chmod 600 "$local_file"
            wl-copy < "$local_file"
            notify-send "Region Capture" "Saved to $local_file and copied to clipboard" -a "Screenshot" -t 3000
        fi
        ;;
    screen)

        grim "$local_file"
        if [[ -f "$local_file" ]]; then
            chmod 600 "$local_file"
            wl-copy < "$local_file"
            notify-send "Screenshot" "Saved to $local_file and copied to clipboard" -a "Screenshot" -t 3000
        fi
        ;;
    save)

        grim "$local_file"
        if [[ -f "$local_file" ]]; then
            chmod 600 "$local_file"
            wl-copy < "$local_file"
            notify-send "Screenshot Saved" "Saved to $local_file" -a "Screenshot" -t 3000
        fi
        ;;
    *)
        echo "Usage: $0 {edit|region|screen|save}"
        exit 1
        ;;
esac
