// Dash Log
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { AGS_CACHE_DIR } from "./Paths"

export type LogCat = 'fn' | 'lrclib' | 'ytdlp'
export type FnLogSource = 'Hyprland' | 'Hyprlock' | 'AGS' | 'Gjs' | 'Astal'

export type LogLevel =
  | 'req' | 'lyr' | 'cache' | 'nolyr' | 'neterr'
  | 'ok' | 'miss' | 'skip' | 'err' | 'log' | 'message' | 'debug' | 'warn' | 'error'

export interface LogEntry {
  t:       number
  level:   LogLevel
  msg:     string
  detail?: string
  source?: FnLogSource
}

const DIR = GLib.build_filenamev([AGS_CACHE_DIR, 'logs'])
const MAX = 400
const subs = new Set<(cat: LogCat) => void>()
const cache = new Map<LogCat, LogEntry[]>()

const pathFor = (c: LogCat) => `${DIR}/${c === 'fn' ? 'warn' : c}.json`

function read(c: LogCat): LogEntry[] {
  const cached = cache.get(c)
  if (cached) return cached
  try {
    const [ok, raw] = GLib.file_get_contents(pathFor(c))
    if (GLib.file_test(pathFor(c), GLib.FileTest.EXISTS)) GLib.chmod(pathFor(c), 0o600)
    if (!ok) {
      const empty: LogEntry[] = []
      cache.set(c, empty)
      return empty
    }
    const j = JSON.parse(new TextDecoder().decode(raw))
    const entries: LogEntry[] = Array.isArray(j) ? j : []
    cache.set(c, entries)
    return entries
  } catch (_) {
    const empty: LogEntry[] = []
    cache.set(c, empty)
    return empty
  }
}

const writeTimers = new Map<LogCat, number>()

function flushWrite(c: LogCat) {
  const arr = cache.get(c) ?? []
  try {
    GLib.mkdir_with_parents(DIR, 0o700)
    GLib.chmod(DIR, 0o700)
    Gio.File.new_for_path(pathFor(c)).replace_contents(
      new TextEncoder().encode(JSON.stringify(arr)),
      null, false,
      Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
      null,
    )
    GLib.chmod(pathFor(c), 0o600)
  } catch (_) {}
}

function scheduleWrite(c: LogCat) {
  if (writeTimers.has(c)) return
  const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
    writeTimers.delete(c)
    flushWrite(c)
    return GLib.SOURCE_REMOVE
  })
  writeTimers.set(c, id)
}

function write(c: LogCat, arr: LogEntry[]) {
  cache.set(c, arr)
  scheduleWrite(c)
}

function notify(c: LogCat) {
  subs.forEach(cb => { try { cb(c) } catch (_) {} })
}

export function logEvent(cat: LogCat, level: LogLevel, msg: string, detail?: string, source?: FnLogSource) {
  const arr = read(cat)
  arr.push({ t: Date.now(), level, msg, detail, source })
  if (arr.length > MAX) arr.splice(0, arr.length - MAX)
  write(cat, arr)
  notify(cat)
}

let lastFnSig = ''
let lastFnAt  = 0

export function logFn(source: FnLogSource, level: 'log' | 'message' | 'debug' | 'warn' | 'error', msg: string, detail?: string) {
  const clean = String(msg).trim()
  if (!clean) return
  const now = Date.now()
  const sig = `${source}\u0000${level}\u0000${clean}\u0000${detail ?? ''}`

  if (sig === lastFnSig && now - lastFnAt < 1500) return
  lastFnSig = sig
  lastFnAt  = now
  logEvent('fn', level, clean, detail, source)
}

export const logWarn  = (msg: string, detail?: string) => logFn('AGS', 'warn',  msg, detail)
export const logError = (msg: string, detail?: string) => logFn('AGS', 'error', msg, detail)

export function readLog(cat: LogCat): LogEntry[] { return [...read(cat)] }

export function clearLog(cat: LogCat) {
  const timer = writeTimers.get(cat)
  if (timer != null) {
    GLib.source_remove(timer)
    writeTimers.delete(cat)
  }
  cache.set(cat, [])
  flushWrite(cat)
  notify(cat)
}

export function subscribeLogs(cb: (cat: LogCat) => void): () => void {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function dwarn(...args: any[]) {
  try { console.warn(...args) } catch (_) {}
  try { logWarn(args.map(String).join(' ')) } catch (_) {}
}
export function derr(...args: any[]) {
  try { console.error(...args) } catch (_) {}
  try { logError(args.map(String).join(' ')) } catch (_) {}
}
