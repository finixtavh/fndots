// Fn Log Collector
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { FnLogSource, logFn, readLog } from "./DashLog"
import { loadSettings } from "./UserSettings"
import { AGS_CACHE_DIR } from "./Paths"

const AGS_LOG = `${AGS_CACHE_DIR}/ags.log`

type FnLevel = 'log' | 'message' | 'debug' | 'warn' | 'error'

interface Collector {
  proc: Gio.Subprocess
  cancel: Gio.Cancellable
  stream: Gio.DataInputStream
}

const collectors: Collector[] = []
let running = false

export function fnDebugEnabled(): boolean {
  return loadSettings().debugMode === true
}

export const FN_DEBUG = fnDebugEnabled()

function levelFromText(text: string, fallback: FnLevel = 'log'): FnLevel {
  if (/\b(fatal|critical|panic|js error|exception|error|failed|failure)\b/i.test(text)) return 'error'
  if (/\b(warn|warning)\b/i.test(text)) return 'warn'
  if (/\bdebug\b/i.test(text)) return 'log'
  if (/\bmessage\b/i.test(text)) return 'message'
  return fallback
}

function sourceFromText(text: string): FnLogSource | null {
  if (/hyprlock/i.test(text)) return 'Hyprlock'
  if (/hyprland|uwsm[_-]?hypr/i.test(text)) return 'Hyprland'
  if (/\bgjs\b|Gjs-/i.test(text)) return 'Gjs'
  if (/\bastal\b/i.test(text)) return 'Astal'
  if (/\bags(?:-bar)?\b|MusicBar|AppLauncher|DashboardPanel/i.test(text)) return 'AGS'
  return null
}

function useful(source: FnLogSource, level: FnLevel, text: string): boolean {
  if (level === 'error' || level === 'warn') return true
  if (source === 'Hyprland' && /button-debounce|mouse-wheel|cursor buffer imported|atomic drm request|libinput.*state:/i.test(text)) return false
  if (source === 'Hyprland' && !/config|reload|monitor|workspace|launch|start|socket|plugin|renderer|backend|session|exec|hook/i.test(text)) return false
  if (/^\s*$/.test(text)) return false
  return true
}

function cleanMessage(line: string): string {
  return line
    .replace(/^\s*\(gjs:\d+\):\s*Gjs-(?:CRITICAL|WARNING|MESSAGE|DEBUG)\s+\*\*:\s*(?:\d{2}:\d{2}:\d{2}(?:\.\d+)?\s*)?/i, '')
    .replace(/^\s*\[[A-Z]+\]\s*/i, '')
    .replace(/^\s*(?:DEBUG|TRACE|INFO|LOG|WARN(?:ING)?|ERR(?:OR)?|CRITICAL)\s*(?:from\s+[^\]]+\])?\s*:?\s*/i, '')
    .trim()
}

function spawnLines(argv: string[], onLine: (line: string) => void): void {
  try {
    const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE)
    const pipe = proc.get_stdout_pipe()
    if (!pipe) { proc.force_exit(); return }
    const stream = Gio.DataInputStream.new(pipe)
    const cancel = new Gio.Cancellable()
    const collector = { proc, cancel, stream }
    collectors.push(collector)

    const next = () => {
      if (!running || cancel.is_cancelled()) return
      stream.read_line_async(GLib.PRIORITY_LOW, cancel, (_s, result) => {
        if (!running || cancel.is_cancelled()) return
        try {
          const [line] = stream.read_line_finish_utf8(result)
          if (line === null) return
          onLine(line)
          next()
        } catch {}
      })
    }
    next()
  } catch (e) {
    logFn('AGS', 'error', `FN-Logs collector failed to start: ${argv[0]}`, String(e))
  }
}

function followTextFile(path: string, hint: FnLogSource): void {
  let previousSource: FnLogSource = hint
  let previousLevel: FnLevel = 'log'
  spawnLines(['tail', '--lines=0', '--follow=name', '--retry', path], line => {
    const isContinuation = /^\s+|^[^\s]+@(?:file|resource):\/\//.test(line)
    const source = sourceFromText(line) ?? (isContinuation ? previousSource : hint)
    const level  = isContinuation ? previousLevel : levelFromText(line)
    const msg    = cleanMessage(line)
    previousSource = source
    previousLevel  = level
    if (useful(source, level, msg)) logFn(source, level, msg)
  })
}

function importPreviousAgsErrors(): void {
  try {
    const [ok, raw] = GLib.file_get_contents(AGS_LOG)
    if (!ok) return
    const lines = new TextDecoder().decode(raw).split('\n').slice(-160)
    const seen = new Set(readLog('fn').map(e => `${e.source ?? 'AGS'}\u0000${e.level}\u0000${e.msg}`))
    let source: FnLogSource = 'AGS'
    let level: FnLevel = 'log'
    let capturing = false
    for (const line of lines) {
      const continuation = /^\s+|^[^\s]+@(?:file|resource):\/\//.test(line)
      if (!continuation) {
        source = sourceFromText(line) ?? 'AGS'
        level = levelFromText(line)
        capturing = level === 'error' || level === 'warn'
      }
      if (!capturing || (!line.trim())) continue
      const msg = cleanMessage(line)
      const sig = `${source}\u0000${level}\u0000${msg}`
      if (!seen.has(sig)) {
        logFn(source, level, msg)
        seen.add(sig)
      }
    }
  } catch (_) {}
}

function findHyprlandLog(): string | null {
  const base = `${GLib.get_user_runtime_dir()}/hypr`
  const signature = GLib.getenv("HYPRLAND_INSTANCE_SIGNATURE")
  if (signature) {
    const current = `${base}/${signature}/hyprland.log`
    if (GLib.file_test(current, GLib.FileTest.IS_REGULAR)) return current
  }
  try {
    const dir = GLib.Dir.open(base, 0)
    let name = dir.read_name()
    while (name !== null) {
      const path = `${base}/${name}/hyprland.log`
      if (GLib.file_test(path, GLib.FileTest.IS_REGULAR)) return path
      name = dir.read_name()
    }
  } catch (_) {}
  return null
}

function followJournal(): void {
  spawnLines(['journalctl', '--user', '--follow', '--lines=0', '--output=json'], line => {
    try {
      const record = JSON.parse(line)
      const identity = [record.SYSLOG_IDENTIFIER, record._COMM, record._EXE, record._SYSTEMD_USER_UNIT].filter(Boolean).join(' ')
      const message  = String(record.MESSAGE ?? '').trim()
      const source   = sourceFromText(`${identity} ${message}`)
      if (!source || !message) return
      const priority = Number(record.PRIORITY)
      const fallback: FnLevel = Number.isFinite(priority) && priority <= 3
        ? 'error'
        : Number.isFinite(priority) && priority === 4 ? 'warn' : 'log'
      const level = levelFromText(message, fallback)
      if (useful(source, level, message)) logFn(source, level, message)
    } catch (_) {}
  })
}

export function startFnLogCollector(): void {
  if (running || !FN_DEBUG) return
  running = true
  GLib.mkdir_with_parents(AGS_CACHE_DIR, 0o755)
  importPreviousAgsErrors()
  logFn('AGS', 'log', 'Debug mode enabled; FN-Logs collectors started')
  followTextFile(AGS_LOG, 'AGS')
  const hyprLog = findHyprlandLog()
  if (hyprLog) followTextFile(hyprLog, 'Hyprland')
  followJournal()
}

export function stopFnLogCollector(): void {
  if (!running && collectors.length === 0) return
  running = false
  while (collectors.length) {
    const c = collectors.pop()!
    try { c.cancel.cancel() } catch (_) {}
    try { c.stream.close(null) } catch (_) {}
    try { c.proc.force_exit() } catch (_) {}
  }
}
