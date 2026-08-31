#!/usr/bin/env bash
# launch ags

set -u
umask 077

config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
cache_home="${XDG_CACHE_HOME:-$HOME/.cache}"
[[ "$config_home" == /* ]] || config_home="$HOME/.config"
[[ "$cache_home" == /* ]] || cache_home="$HOME/.cache"

ags_config_dir="$config_home/ags"
settings_file="$ags_config_dir/user-settings.json"
log_dir="$cache_home/ags"
log_file="${log_dir}/ags.log"

mkdir -p -m700 "${log_dir}"
chmod 700 "${log_dir}"

find "${log_dir}" -xdev -type d -exec chmod 700 -- {} + 2>/dev/null || true
find "${log_dir}" -xdev -type f -exec chmod 600 -- {} + 2>/dev/null || true

if [[ -r "${settings_file}" ]] && grep -Eq '"debugMode"[[:space:]]*:[[:space:]]*true' "${settings_file}"; then
  if [[ -e "${log_file}" ]]; then
    chmod 600 "${log_file}"
  fi

  if [[ -f "${log_file}" ]] && [[ $(stat -c %s "${log_file}" 2>/dev/null || printf '0') -gt 2097152 ]]; then
    tail -c 1048576 "${log_file}" > "${log_file}.trim"
    chmod 600 "${log_file}.trim"
    mv "${log_file}.trim" "${log_file}"
  fi
  exec ags run "$ags_config_dir/app.ts" -g 3 >>"${log_file}" 2>&1
fi

exec ags run "$ags_config_dir/app.ts" -g 3 >/dev/null 2>&1
