#!/usr/bin/env bash
# lowend benchmark

set -uo pipefail

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
[[ "$CONFIG_HOME" == /* ]] || CONFIG_HOME="$HOME/.config"
AGS_CONFIG_DIR="$CONFIG_HOME/ags"
SETTINGS="$AGS_CONFIG_DIR/user-settings.json"
INSTANCE="ags-bar"
NP_REQUEST="toggle-nowplaying"

PHASE_SEC=30
SETTLE_SEC=5
TOGGLE_EVERY=3
CLK=$(getconf CLK_TCK)
NPROC=$(nproc)

ags_pids() {
  pgrep -f "gjs -m /run/user/[0-9]*/ags.js"
  pgrep -x cava
}

proc_jiffies() {
  local total=0 pid st rest us
  for pid in $(ags_pids); do
    [ -r "/proc/$pid/stat" ] || continue
    st=$(<"/proc/$pid/stat")
    rest=${st#*) }
    us=$(awk '{print $12+$13}' <<<"$rest")
    total=$(( total + ${us:-0} ))
  done
  echo "$total"
}

proc_rss_kb() {
  local total=0 pid v
  for pid in $(ags_pids); do
    v=$(awk '/^VmRSS:/{print $2}' "/proc/$pid/status" 2>/dev/null)
    total=$(( total + ${v:-0} ))
  done
  echo "$total"
}

set_lowend() {
  python3 - "$SETTINGS" "$1" <<'PY'
import json, os, sys, tempfile
f, val = sys.argv[1], sys.argv[2] == 'true'
try:
    with open(f, encoding='utf-8') as stream:
        d = json.load(stream)
except FileNotFoundError:
    d = {}
except (OSError, json.JSONDecodeError) as error:
    print(f'Cannot update invalid settings file {f}: {error}', file=sys.stderr)
    raise SystemExit(1)
if not isinstance(d, dict):
    print(f'Cannot update settings because {f} does not contain an object', file=sys.stderr)
    raise SystemExit(1)
d['lowEndDevice'] = val
directory = os.path.dirname(f)
os.makedirs(directory, mode=0o700, exist_ok=True)
fd, staged = tempfile.mkstemp(prefix='.user-settings.', dir=directory)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(d, stream, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(staged, f)
except BaseException:
    try:
        os.unlink(staged)
    except FileNotFoundError:
        pass
    raise
PY
}

get_lowend() {
  python3 - "$SETTINGS" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as stream:
        data = json.load(stream)
except FileNotFoundError:
    data = {}
except (OSError, json.JSONDecodeError) as error:
    print(f'Cannot read settings file {sys.argv[1]}: {error}', file=sys.stderr)
    raise SystemExit(1)
if not isinstance(data, dict):
    print(f'Cannot read settings because {sys.argv[1]} does not contain an object', file=sys.stderr)
    raise SystemExit(1)
value = data.get('lowEndDevice', False)
if not isinstance(value, bool):
    print(f'Cannot read settings because lowEndDevice is not boolean', file=sys.stderr)
    raise SystemExit(1)
print(str(value).lower())
PY
}

restart_ags() {
  ags quit -i "$INSTANCE" 2>/dev/null
  sleep 0.5
  nohup "$AGS_CONFIG_DIR/scripts/launch-ags.sh" >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

measure_phase() {
  local j0 j1 rss_sum=0 rss_n=0 elapsed=0 next_toggle=$TOGGLE_EVERY
  local cava_seen=0
  local start end
  start=$(date +%s.%N)
  j0=$(proc_jiffies)
  while :; do
    sleep 1
    elapsed=$(( elapsed + 1 ))
    rss_sum=$(( rss_sum + $(proc_rss_kb) )); rss_n=$(( rss_n + 1 ))
    pgrep -x cava >/dev/null && cava_seen=1
    if [ "$elapsed" -ge "$next_toggle" ]; then
      ags request -i "$INSTANCE" "$NP_REQUEST" >/dev/null 2>&1
      next_toggle=$(( next_toggle + TOGGLE_EVERY ))
    fi
    [ "$elapsed" -ge "$PHASE_SEC" ] && break
  done
  j1=$(proc_jiffies)
  end=$(date +%s.%N)
  awk -v d=$(( j1 - j0 )) -v clk="$CLK" -v np="$NPROC" \
      -v rs="$rss_sum" -v rn="$rss_n" -v cava="$cava_seen" \
      -v start="$start" -v end="$end" 'BEGIN{
    wall = end - start; if (wall <= 0) wall = 1
    core = (d/clk)/wall*100
    printf "%.2f|%.2f|%.1f|%d\n", core, core/np, (rs/rn)/1024, cava
  }'
}

echo "════════════════════════════════════════════════════════════"
echo "  Low-end device benchmark  (~85s, AGS will restart 3×)"
echo "  CLK_TCK=$CLK  cores=$NPROC  phase=${PHASE_SEC}s  settle=${SETTLE_SEC}s"
echo "════════════════════════════════════════════════════════════"

if ! ORIG=$(get_lowend); then
  echo "Could not read the current lowEndDevice setting; benchmark aborted." >&2
  exit 1
fi
RESTORE_NEEDED=true
restore_original() {
  [[ "$RESTORE_NEEDED" == true ]] || return
  if ! set_lowend "$ORIG"; then
    echo "ERROR: could not restore lowEndDevice = $ORIG" >&2
    return 1
  fi
  if ! restart_ags; then
    echo "ERROR: setting was restored, but AGS could not be restarted" >&2
    return 1
  fi
  RESTORE_NEEDED=false
}
on_exit() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ "$RESTORE_NEEDED" == true ]] && ! restore_original; then
    [[ $status -ne 0 ]] || status=1
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' HUP INT TERM

echo "Saved current lowEndDevice = $ORIG (restored at end)"

echo
echo ">> Phase A — Low-end OFF … restarting AGS, settling ${SETTLE_SEC}s"
if ! set_lowend false; then
  echo "Could not enable the Phase A setting; benchmark aborted." >&2
  exit 1
fi
restart_ags
sleep "$SETTLE_SEC"
A=$(measure_phase)

echo ">> Phase B — Low-end ON  … restarting AGS, settling ${SETTLE_SEC}s"
if ! set_lowend true; then
  echo "Could not enable the Phase B setting; benchmark aborted." >&2
  exit 1
fi
restart_ags
sleep "$SETTLE_SEC"
B=$(measure_phase)

echo ">> Restoring lowEndDevice = $ORIG … restarting AGS"
if ! restore_original; then
  exit 1
fi
trap - EXIT HUP INT TERM

IFS='|' read -r A_CORE A_ALL A_RSS A_CAVA <<<"$A"
IFS='|' read -r B_CORE B_ALL B_RSS B_CAVA <<<"$B"

echo
echo "════════════════════════════════════════════════════════════"
printf "  %-16s %14s %14s\n" "" "Low-end OFF" "Low-end ON"
printf "  %-16s %13s%% %13s%%\n" "CPU (1 core)"   "$A_CORE" "$B_CORE"
printf "  %-16s %13s%% %13s%%\n" "CPU (all cores)" "$A_ALL"  "$B_ALL"
printf "  %-16s %12sMB %12sMB\n" "RAM (avg)"       "$A_RSS"  "$B_RSS"
printf "  %-16s %14s %14s\n"     "cava running"    "$([ "$A_CAVA" = 1 ] && echo yes || echo no)" "$([ "$B_CAVA" = 1 ] && echo yes || echo no)"
echo "════════════════════════════════════════════════════════════"

awk -v a="$A_CORE" -v b="$B_CORE" -v ar="$A_RSS" -v br="$B_RSS" 'BEGIN{
  dc = a - b; dr = ar - br
  cpupct = (a>0)? dc/a*100 : 0
  rampct = (ar>0)? dr/ar*100 : 0
  printf "  CPU: %+.2f%% of one core  (%.0f%% %s)\n", -dc, (dc>=0?cpupct:-cpupct), (dc>=0?"lower":"HIGHER")
  printf "  RAM: %+.1f MB            (%.0f%% %s)\n",   -dr, (dr>=0?rampct:-rampct), (dr>=0?"lower":"HIGHER")
  print ""
  if (dc > 0.5)
    print "  VERDICT: Low-end device REDUCES CPU. Positive effect. ✔"
  else if (dc < -0.5)
    print "  VERDICT: Low-end device INCREASED CPU?! Re-run when idle."
  else
    print "  VERDICT: CPU difference negligible (was the bar idle/silent?)."
}'
echo "════════════════════════════════════════════════════════════"
