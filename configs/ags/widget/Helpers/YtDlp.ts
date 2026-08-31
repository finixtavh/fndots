// Yt Dlp
import GLib from "gi://GLib"
import Gio  from "gi://Gio"
import { logEvent } from "./DashLog"
import { LOW_END } from "./Perf"
import { AGS_CACHE_DIR, cachePath } from "./Paths"

export const YTDLP_AVAILABLE: boolean = !!GLib.find_program_in_path('yt-dlp')

const CACHE_FILE = cachePath('ags', 'ytdlp-categories.json')
const CACHE_TTL  = 7 * 24 * 3600 * 1000
const MAX_CACHE_ENTRIES = 512
const LOOKUP_TIMEOUT_MS = 15_000

interface CacheEntry { isMusic: boolean; checkedAt: number }
const _cache = new Map<string, CacheEntry>()
const _inflight = new Map<string, Promise<boolean>>()

function _loadCache() {
  try {
    GLib.mkdir_with_parents(AGS_CACHE_DIR, 0o700)
    GLib.chmod(AGS_CACHE_DIR, 0o700)
    if (GLib.file_test(CACHE_FILE, GLib.FileTest.EXISTS)) GLib.chmod(CACHE_FILE, 0o600)
    const [ok, raw] = GLib.file_get_contents(CACHE_FILE)
    if (!ok) return
    const obj = JSON.parse(new TextDecoder().decode(raw)) as Record<string, CacheEntry>
    const now = Date.now()
    for (const [k, v] of Object.entries(obj)) {
      if (!v || typeof v.isMusic !== 'boolean' || !Number.isFinite(v.checkedAt)) continue
      if (k.length <= 4096 && now - v.checkedAt < CACHE_TTL) _cache.set(k, v)
    }
  } catch (_) {}
}

function _saveCache() {
  try {
    GLib.mkdir_with_parents(AGS_CACHE_DIR, 0o700)
    GLib.chmod(AGS_CACHE_DIR, 0o700)
    if (_cache.size > MAX_CACHE_ENTRIES) {
      ;[..._cache.entries()]
        .sort(([, left], [, right]) => right.checkedAt - left.checkedAt)
        .slice(MAX_CACHE_ENTRIES)
        .forEach(([key]) => _cache.delete(key))
    }
    const obj: Record<string, CacheEntry> = {}
    for (const [k, v] of _cache) obj[k] = v
    const bytes = new TextEncoder().encode(JSON.stringify(obj))
    Gio.File.new_for_path(CACHE_FILE).replace_contents(
      bytes, null, false,
      Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
      null,
    )
    GLib.chmod(CACHE_FILE, 0o600)
  } catch (_) {}
}

_loadCache()

const NON_MUSIC_CATEGORIES = new Set([
  'Gaming', 'Science & Technology', 'Sports', 'News & Politics',
  'Howto & Style', 'Education', 'Travel & Events', 'Autos & Vehicles',
  'Pets & Animals', 'Nonprofits & Activism',
])

function _isMusic(out: string): boolean {
  if (!out || out.trim() === 'NA' || out.trim() === '[]' || out.trim() === 'null') return true
  let cats: string[] = []
  try {
    const parsed = JSON.parse(out.trim())
    if (Array.isArray(parsed)) cats = parsed.filter((item): item is string => typeof item === 'string')
  } catch (_) {}
  if (cats.length === 0) return true
  return !cats.some(c => NON_MUSIC_CATEGORIES.has(c))
}

export function youtubeVideoId(url: string): string | null {
  if (!url) return null
  let candidate = url
  try { candidate = decodeURIComponent(url) } catch (_) {}
  const queryId = candidate.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  if (queryId) return queryId[1]
  const pathId = candidate.match(/(?:youtu\.be\/|(?:music\.)?youtube\.com\/(?:shorts|embed|live)\/)([a-zA-Z0-9_-]{11})/i)
  return pathId?.[1] ?? null
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

export function checkIsMusic(ytWatchUrl: string): Promise<boolean> {
  if (LOW_END) return Promise.resolve(true)
  if (!YTDLP_AVAILABLE || !ytWatchUrl) return Promise.resolve(true)

  const cached = getCachedResult(ytWatchUrl)
  if (cached !== null) return Promise.resolve(cached)
  const running = _inflight.get(ytWatchUrl)
  if (running) return running

  const request = new Promise<boolean>((resolve) => {
    try {
      logEvent('ytdlp', 'req', `yt-dlp categories lookup`, ytWatchUrl)
      const proc = Gio.Subprocess.new(
        [
          'yt-dlp', '--print', '%(categories)j', '--no-warnings',
          '--socket-timeout', '8', '--retries', '1', ytWatchUrl,
        ],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
      )
      let settled = false
      let timeoutId: number | null = null
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        if (timeoutId !== null) GLib.source_remove(timeoutId)
        timeoutId = null
        resolve(value)
      }
      timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LOOKUP_TIMEOUT_MS, () => {
        timeoutId = null
        if (!settled) {
          try { proc.force_exit() } catch (_) {}
          logEvent('ytdlp', 'err', 'yt-dlp lookup timed out (fail-open: tracked)', ytWatchUrl)
          finish(true)
        }
        return GLib.SOURCE_REMOVE
      })
      proc.communicate_utf8_async(null, null, (_p: any, res: any) => {
        try {
          const [, stdout] = proc.communicate_utf8_finish(res)
          if (!proc.get_successful()) {
            logEvent('ytdlp', 'err', `yt-dlp lookup failed (fail-open: tracked)`, ytWatchUrl)
            finish(true)
            return
          }
          const isMusic = _isMusic(stdout ?? '')
          _cache.set(ytWatchUrl, { isMusic, checkedAt: Date.now() })
          _saveCache()
          logEvent('ytdlp', 'ok', `${isMusic ? 'music -> tracked' : 'non-music -> skipped'}  [${(stdout ?? '').trim() || 'NA'}]`, ytWatchUrl)
          finish(isMusic)
        } catch (_) {
          logEvent('ytdlp', 'err', `yt-dlp parse failed (fail-open: tracked)`, ytWatchUrl)
          finish(true)
        }
      })
    } catch (e) {
      logEvent('ytdlp', 'err', `yt-dlp spawn failed (fail-open: tracked)`, `${ytWatchUrl}  ${String(e)}`)
      resolve(true)
    }
  })
  _inflight.set(ytWatchUrl, request)
  request.finally(() => {
    if (_inflight.get(ytWatchUrl) === request) _inflight.delete(ytWatchUrl)
  })
  return request
}

export function getCachedResult(ytWatchUrl: string): boolean | null {
  const entry = _cache.get(ytWatchUrl)
  if (entry && Date.now() - entry.checkedAt >= CACHE_TTL) {
    _cache.delete(ytWatchUrl)
    return null
  }
  return entry ? entry.isMusic : null
}
