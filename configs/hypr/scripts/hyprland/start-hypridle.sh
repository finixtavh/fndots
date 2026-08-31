#!/usr/bin/env bash
# start hypridle
set -euo pipefail
umask 077

SETTINGS="${XDG_CONFIG_HOME:-$HOME/.config}/ags/user-settings.json"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)

if [[ ${1:-} == --restart ]]; then
    pkill -x hypridle 2>/dev/null || true
    nohup "$0" >/dev/null 2>&1 &
    exit 0
fi

enabled=true
minutes=30
if [[ -r "$SETTINGS" ]] && command -v jq >/dev/null 2>&1; then
    enabled=$(jq -r 'if .idleLockEnabled == false then "false" else "true" end' "$SETTINGS" 2>/dev/null || printf true)
    minutes=$(jq -r 'if (.idleLockMinutes | type) == "number" then .idleLockMinutes else 30 end' "$SETTINGS" 2>/dev/null || printf 30)
fi
[[ "$enabled" == true ]] || exit 0

seconds=$(awk -v value="$minutes" 'BEGIN {
    if (value !~ /^[0-9]+([.][0-9]+)?$/ || value < 0.1 || value > 1440) value = 30
    rounded = int(value * 60 + 0.5)
    print rounded < 1 ? 1 : rounded
}')

runtime_base="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/dotfiles-v2"
install -d -m 700 -- "$runtime_base"
runtime_config="$runtime_base/hypridle.conf"
temporary="$runtime_config.tmp.$$"
lock_script="$SCRIPT_DIR/../hyprlock/launch.sh"
printf '%s\n' \
    'general {' \
    "    lock_cmd = pidof hyprlock || $(printf '%q' "$lock_script")" \
    '    before_sleep_cmd = loginctl lock-session' \
    '    after_sleep_cmd = hyprctl dispatch dpms on' \
    '}' \
    '' \
    'listener {' \
    "    timeout = $seconds" \
    "    on-timeout = $(printf '%q' "$lock_script")" \
    '}' > "$temporary"
chmod 600 -- "$temporary"
mv -f -- "$temporary" "$runtime_config"

exec hypridle -c "$runtime_config"
