#!/usr/bin/env bash

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
[[ "$CONFIG_HOME" == /* ]] || CONFIG_HOME="$HOME/.config"
IMAGES_DIR="$CONFIG_HOME/wallman/terminal_wallpapers"
COLS="${COLUMNS:-80}"
[[ "$COLS" =~ ^[0-9]+$ ]] || COLS=80

IMAGE_PATH=$(find "$IMAGES_DIR" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \) 2>/dev/null | shuf -n 1)

if [ -z "$IMAGE_PATH" ]; then
    fastfetch
    exit 0
fi

# Responsive width: terminal cols - 55 (reserved for text) = available for image
W=$(( COLS - 55 ))
(( W > 38 )) && W=38
(( W < 10 )) && W=0

if (( W > 0 )); then
    fastfetch --logo-type kitty --logo-recache --logo-width "$W" --logo "$IMAGE_PATH"
else
    fastfetch
fi
