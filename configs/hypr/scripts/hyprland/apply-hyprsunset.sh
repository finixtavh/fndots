#!/usr/bin/env bash
# apply hyprsunset
set -euo pipefail

SETTINGS="${XDG_CONFIG_HOME:-$HOME/.config}/ags/user-settings.json"
enabled=false
temperature=4000
if [[ -r "$SETTINGS" ]] && command -v jq >/dev/null 2>&1; then
    enabled=$(jq -r 'if .hyprsunsetEnabled == true then "true" else "false" end' "$SETTINGS" 2>/dev/null || printf false)
    temperature=$(jq -r 'if (.hyprsunsetTemperature | type) == "number" then .hyprsunsetTemperature else 4000 end' "$SETTINGS" 2>/dev/null || printf 4000)
fi
if ! [[ "$temperature" =~ ^[0-9]+$ ]] || (( temperature < 1000 || temperature > 20000 )); then
    temperature=4000
fi

for _attempt in 1 2 3 4 5; do
    if [[ "$enabled" == true ]]; then
        hyprctl hyprsunset temperature "$temperature" && exit 0
    else
        hyprctl hyprsunset identity && exit 0
    fi
    sleep 0.2
done
exit 1
