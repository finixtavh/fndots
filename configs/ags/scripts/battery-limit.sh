#!/usr/bin/env bash
# battery limit

set -euo pipefail
umask 077

FLAG="/etc/ags-battery-limit-enabled"
HELPER="/usr/local/libexec/ags-battery-limit"
UNIT="/etc/systemd/system/ags-battery-limit.service"
SCRIPT_NAME="${0##*/}"

SYSFS=""
for candidate in /sys/class/power_supply/*/charge_control_end_threshold; do
  if [[ -e "$candidate" ]]; then
    SYSFS="$candidate"
    break
  fi
done

if [[ -z "$SYSFS" ]]; then
  printf '%s: no supported battery charge-threshold control was found\n' "$SCRIPT_NAME" >&2
  exit 3
fi

ARG="${1:-}"
if [[ "$ARG" == "status" ]]; then
  value=$(<"$SYSFS")
  [[ "$value" =~ ^[0-9]+$ ]] && (( 10#$value <= 100 )) || {
    printf '%s: invalid threshold reported by %s\n' "$SCRIPT_NAME" "$SYSFS" >&2
    exit 4
  }
  printf '%s\n' "$value"
  exit 0
fi

if [[ "$ARG" != "80" && "$ARG" != "100" && "$ARG" != "restore" ]]; then
  printf '%s: argument must be 80, 100, status, or restore; got %q\n' "$SCRIPT_NAME" "$ARG" >&2
  exit 2
fi

if (( EUID != 0 )); then
  printf '%s: %s requires root privileges\n' "$SCRIPT_NAME" "$ARG" >&2
  exit 5
fi

if [[ "$ARG" == "restore" ]]; then
  state="0"
  [[ -r "$FLAG" ]] && read -r state < "$FLAG"
  [[ "$state" == "1" ]] && ARG="80" || ARG="100"
  printf '%s\n' "$ARG" > "$SYSFS"
  exit 0
fi

install_restore_service() {
  local unit_tmp
  unit_tmp=$(mktemp "${UNIT}.tmp.XXXXXX")
  cat > "$unit_tmp" <<'EOF'
[Unit]
Description=Restore the configured battery charge limit
After=local-fs.target
ConditionPathExists=/etc/ags-battery-limit-enabled

[Service]
Type=oneshot
ExecStart=/usr/local/libexec/ags-battery-limit restore

[Install]
WantedBy=multi-user.target
EOF
  chmod 0644 "$unit_tmp"
  mv -f -- "$unit_tmp" "$UNIT"
  systemctl daemon-reload
  systemctl enable --quiet ags-battery-limit.service
}

install_restore_service

flag_tmp=$(mktemp "${FLAG}.tmp.XXXXXX")
trap 'rm -f -- "$flag_tmp"' EXIT
if [[ "$ARG" == "80" ]]; then
  printf '1\n' > "$flag_tmp"
else
  printf '0\n' > "$flag_tmp"
fi
chmod 0644 "$flag_tmp"
previous_threshold=$(<"$SYSFS")
if ! printf '%s\n' "$ARG" > "$SYSFS"; then
  printf '%s: could not apply threshold %s; persistent state was not changed\n' \
    "$SCRIPT_NAME" "$ARG" >&2
  exit 6
fi
if ! mv -f -- "$flag_tmp" "$FLAG"; then
  printf '%s: could not persist threshold state; restoring %s\n' \
    "$SCRIPT_NAME" "$previous_threshold" >&2
  printf '%s\n' "$previous_threshold" > "$SYSFS" || \
    printf '%s: WARNING: runtime threshold rollback failed\n' "$SCRIPT_NAME" >&2
  exit 7
fi
trap - EXIT

exit 0
