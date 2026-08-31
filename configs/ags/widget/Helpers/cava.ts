// cava
import { subprocess, Process } from "ags/process"
import app from "ags/gtk3/app"
import Gdk from "gi://Gdk"
import GLib from "gi://GLib"
import { loadSettings } from "./UserSettings"

export const NUM_BARS = 20
export const cavaData = { bars: Array(NUM_BARS).fill(0) as number[] }

function detectRefreshHz(): number {
  try {
    const display = Gdk.Display.get_default()
    let detected = 0
    for (let index = 0; index < (display?.get_n_monitors() ?? 0); index++) {
      const mhz = (display?.get_monitor(index) as any)?.get_refresh_rate?.()
      if (mhz && mhz > 0) detected = Math.max(detected, Math.round(mhz / 1000))
    }
    if (detected > 0) return detected
  } catch (_) {}
  return 60
}

export let GDK_HZ = detectRefreshHz()

const _settings  = loadSettings()
let _autoHz      = _settings.cavaAutoHz !== false
const _configuredHz = Number(_settings.cavaManualHz)
const _manualHz  = Number.isFinite(_configuredHz) && _configuredHz > 0
  ? Math.round(_configuredHz)
  : GDK_HZ

export let REFRESH_HZ = _autoHz ? GDK_HZ : _manualHz

function buildCavaPy(hz: number): string {
  return `
import sys, subprocess, tempfile, os, signal
N=20
conf="""[general]
bars=20
framerate=${hz}
sensitivity=160
autosens=1
lower_cutoff_freq=25
higher_cutoff_freq=15000

[input]
method=pipewire
source=auto

[output]
method=raw
raw_target=/dev/stdout
bit_format=8bit
bar_delimiter = 0
channels=mono

[smoothing]
noise_reduction=17
"""
with tempfile.NamedTemporaryFile(mode='w',suffix='.conf',delete=False) as f:
    f.write(conf); cfg=f.name
p=subprocess.Popen(['cava','-p',cfg],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
signal.signal(signal.SIGTERM,lambda*_:(p.terminate(),os.unlink(cfg),sys.exit(0)))
try:
    while True:
        data=p.stdout.read(N)
        if not data or len(data)<N: break
        sys.stdout.write(';'.join(str(b) for b in data)+'\\n'); sys.stdout.flush()
except: pass
finally:
    p.terminate()
    try: os.unlink(cfg)
    except: pass
`
}

let _proc: Process | null = null
let _started       = false
let _currentHz     = REFRESH_HZ
let _retries       = 0
const MAX_RETRIES  = 5
const _retryTimers = new Set<number>()
const _refreshSubscribers = new Set<(hz: number) => void>()
let _display: Gdk.Display | null = null
let _monitorAddedId: number | null = null
let _monitorRemovedId: number | null = null
let _restartTimer: number | null = null
let _shutdownId: number | null = null

function stopProcess(process: Process | null): void {
  if (!process) return
  try { process.signal(15) }
  catch (_) { try { process.kill() } catch (_) {} }
}

function cancelRetries(): void {
  for (const id of _retryTimers) GLib.source_remove(id)
  _retryTimers.clear()
}

function startCavaSubprocess(hz: number) {
  try {
    const proc = subprocess(
      ['python3', '-c', buildCavaPy(hz)],
      (line: string) => {
        _retries = 0
        const vals = line.trim().split(';').map(Number)
        for (let i = 0; i < NUM_BARS; i++) {
          const v = vals[i]
          if (v !== undefined && !isNaN(v)) cavaData.bars[i] = v
        }
      },
      () => {}
    )
    _proc = proc
    try {
      proc?.connect?.('exit', () => {
        if (_proc !== proc) return
        if (_retries++ >= MAX_RETRIES) return
        let retryId = 0
        retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000 * _retries, () => {
          _retryTimers.delete(retryId)
          if (_proc === proc) startCavaSubprocess(_currentHz)
          return GLib.SOURCE_REMOVE
        })
        _retryTimers.add(retryId)
      })
    } catch (_) {}
  } catch (_) {}
}

export function ensureCavaStarted() {
  if (_started) return
  _started = true
  _display = Gdk.Display.get_default()
  const monitorChanged = () => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
      const detected = detectRefreshHz()
      GDK_HZ = detected
      if (_autoHz && detected !== _currentHz) restartCavaWithHz(detected, true)
      return GLib.SOURCE_REMOVE
    })
  }
  try { _monitorAddedId = _display?.connect('monitor-added', monitorChanged) ?? null } catch (_) {}
  try { _monitorRemovedId = _display?.connect('monitor-removed', monitorChanged) ?? null } catch (_) {}
  try {
    _shutdownId = app.connect('shutdown', () => {
      cancelRetries()
      if (_restartTimer !== null) GLib.source_remove(_restartTimer)
      _restartTimer = null
      if (_display && _monitorAddedId !== null) _display.disconnect(_monitorAddedId)
      if (_display && _monitorRemovedId !== null) _display.disconnect(_monitorRemovedId)
      _monitorAddedId = null
      _monitorRemovedId = null
      stopProcess(_proc)
      _proc = null
      _started = false
      _refreshSubscribers.clear()
      if (_shutdownId !== null) {
        _shutdownId = null
      }
    })
  } catch (_) {}
  startCavaSubprocess(_currentHz)
}

export function restartCavaWithHz(hz: number, autoMode = _autoHz) {
  _autoHz = autoMode
  if (_autoHz) GDK_HZ = detectRefreshHz()
  const nextHz = Number.isFinite(hz) && hz > 0 ? Math.round(hz) : GDK_HZ
  REFRESH_HZ   = nextHz
  _currentHz   = nextHz
  _retries     = 0
  cancelRetries()
  if (_restartTimer !== null) GLib.source_remove(_restartTimer)
  stopProcess(_proc)
  _proc = null
  _restartTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
    _restartTimer = null
    if (_started) startCavaSubprocess(nextHz)
    return GLib.SOURCE_REMOVE
  })
  for (const subscriber of _refreshSubscribers) {
    try { subscriber(nextHz) } catch (_) {}
  }
}

export function subscribeCavaRefresh(callback: (hz: number) => void): () => void {
  _refreshSubscribers.add(callback)
  return () => _refreshSubscribers.delete(callback)
}
