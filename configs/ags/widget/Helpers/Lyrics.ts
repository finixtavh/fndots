// Lyrics
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { logEvent } from "./DashLog"
import { LOW_END } from "./Perf"
import { AGS_CACHE_DIR, cachePath } from "./Paths"
import { lyricQueryCandidates, normalizedTrackKey } from "./TrackNormalization"

const LRCLIB_BASE = 'https://lrclib.net/api'

export interface LrclibTrack {
  id:           number
  trackName:    string
  artistName:   string
  albumName:    string
  duration:     number
  instrumental: boolean
  plainLyrics:  string | null
  syncedLyrics: string | null
}

function isLrclibTrack(j: any): j is LrclibTrack {
  const boundedText = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
  const optionalLyrics = (value: unknown) => value === null || boundedText(value, 2 * 1024 * 1024)
  return !!j && typeof j === 'object'
    && Number.isSafeInteger(j.id) && j.id >= 0
    && boundedText(j.trackName, 512)
    && boundedText(j.artistName, 512)
    && boundedText(j.albumName, 512)
    && Number.isFinite(j.duration) && j.duration >= 0 && j.duration <= 24 * 60 * 60
    && typeof j.instrumental === 'boolean'
    && optionalLyrics(j.plainLyrics)
    && optionalLyrics(j.syncedLyrics)
}

function qsEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

const MISS_FILE   = cachePath('ags', 'lrclib-misses.json')
const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_MISS_ENTRIES = 512
let missCache: Record<string, number> | null = null

const BLACKLIST_FILE = cachePath('ags', 'lrclib-blacklist.json')
let blacklist: Set<string> | null = null
let blacklistMtime = 0

function loadBlacklist(): Set<string> {
  try {
    const info = Gio.File.new_for_path(BLACKLIST_FILE)
      .query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null)
    const mtime = Number(info.get_modification_date_time()?.to_unix?.() ?? 0)
    if (blacklist && mtime === blacklistMtime) return blacklist
    const [ok, raw] = GLib.file_get_contents(BLACKLIST_FILE)
    const set = new Set<string>()
    if (ok) {
      const j = JSON.parse(new TextDecoder().decode(raw))
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        for (const entry of Object.values(j)) {
          const e = entry as { artist?: unknown; title?: unknown }
          if (e && typeof e.artist === 'string' && typeof e.title === 'string') {
            set.add(normalizedTrackKey(e.artist, e.title))
          }
        }
      }
    }
    blacklist = set
    blacklistMtime = mtime
    return set
  } catch (_) {
    if (!GLib.file_test(BLACKLIST_FILE, GLib.FileTest.EXISTS)) {
      blacklist = new Set<string>()
      blacklistMtime = 0
    } else if (!blacklist) {
      blacklist = new Set<string>()
    }
    return blacklist
  }
}

export function isLrclibBlacklisted(artist: string, track: string): boolean {
  return loadBlacklist().has(normalizedTrackKey(artist, track))
}

function missKey(artist: string, track: string): string {
  return normalizedTrackKey(artist, track)
}

function loadMisses(): Record<string, number> {
  if (missCache) return missCache
  try {
    GLib.mkdir_with_parents(AGS_CACHE_DIR, 0o700)
    GLib.chmod(AGS_CACHE_DIR, 0o700)
    if (GLib.file_test(MISS_FILE, GLib.FileTest.EXISTS)) GLib.chmod(MISS_FILE, 0o600)
    const [ok, raw] = GLib.file_get_contents(MISS_FILE)
    if (!ok) return (missCache = {})
    const j = JSON.parse(new TextDecoder().decode(raw))
    const valid: Record<string, number> = {}
    const now = Date.now()
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      Object.entries(j)
        .filter(([key, value]) => key.length <= 2048 && Number.isFinite(value)
          && Number(value) > 0 && now - Number(value) <= MISS_TTL_MS)
        .sort(([, left], [, right]) => Number(right) - Number(left))
        .slice(0, MAX_MISS_ENTRIES)
        .forEach(([key, value]) => { valid[key] = Number(value) })
    }
    return (missCache = valid)
  } catch (_) { return (missCache = {}) }
}

function saveMisses(m: Record<string, number>): void {
  missCache = m
  try {
    GLib.mkdir_with_parents(AGS_CACHE_DIR, 0o700)
    GLib.chmod(AGS_CACHE_DIR, 0o700)
    const entries = Object.entries(m)
      .filter(([, timestamp]) => Number.isFinite(timestamp))
      .sort(([, left], [, right]) => right - left)
      .slice(0, MAX_MISS_ENTRIES)
    missCache = Object.fromEntries(entries)
    Gio.File.new_for_path(MISS_FILE).replace_contents(
      new TextEncoder().encode(JSON.stringify(missCache)),
      null, false,
      Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
      null,
    )
    GLib.chmod(MISS_FILE, 0o600)
  } catch (_) {}
}
export function isLrclibMissFresh(artist: string, track: string): boolean {
  const ts = loadMisses()[missKey(artist, track)]
  return !!ts && (Date.now() - ts) <= MISS_TTL_MS
}

function recordLrclibMiss(artist: string, track: string): void {
  const m = loadMisses()
  const now = Date.now()
  for (const k of Object.keys(m)) if (now - m[k] > MISS_TTL_MS) delete m[k]
  m[missKey(artist, track)] = now
  saveMisses(m)
}

function clearLrclibMiss(artist: string, track: string): void {
  const m = loadMisses()
  const k = missKey(artist, track)
  if (k in m) { delete m[k]; saveMisses(m) }
}

const DUR_TOLERANCE_SEC = 12

export function fetchLrclib(artist: string, track: string, album: string, durationSec: number): Promise<LrclibTrack | null> {
  if (LOW_END) return Promise.resolve(null)
  if (!artist || !track || durationSec <= 0) return Promise.resolve(null)
  if (isLrclibBlacklisted(artist, track)) {
    logEvent('lrclib', 'blacklist', `"${track}" — "${artist}"`)
    return Promise.resolve(null)
  }
  if (isLrclibMissFresh(artist, track)) {
    logEvent('lrclib', 'cache', `"${track}" — "${artist}"`)
    return Promise.resolve(null)
  }

  const byDur = (a: LrclibTrack, b: LrclibTrack) =>
    Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec)

  const pick = (out: string): LrclibTrack | null => {
    let arr: any = null
    try { arr = JSON.parse(out) } catch (_) { arr = null }
    const valid: LrclibTrack[] = Array.isArray(arr) ? arr.filter(isLrclibTrack) : []
    if (!valid.length) return null
    const synced = valid.filter(t => t.syncedLyrics).sort(byDur)
    if (synced.length) return synced[0]
    const closest = [...valid].sort(byDur)[0]
    if (closest && closest.instrumental && Math.abs(closest.duration - durationSec) <= DUR_TOLERANCE_SEC) return closest
    return null
  }

  const search = (qArtist: string, qTrack: string, includeAlbum: boolean): Promise<LrclibTrack | null> => {
    const params: Record<string, string> = { artist_name: qArtist, track_name: qTrack }
    if (includeAlbum && album) params.album_name = album
    const url = `${LRCLIB_BASE}/search?${qsEncode(params)}`
    const tag = includeAlbum && album ? '' : ' [no album]'
    logEvent('lrclib', 'req', `request  "${qTrack}" — "${qArtist}"  (${Math.round(durationSec)}s)${tag}`, url)
    return execAsync([
      'curl', '-fsS', '-A', 'FNDots (https://github.com/finixtavh/dotfiles-v2)',
      '--retry', '2', '--retry-delay', '1', '--retry-connrefused',
      '--max-time', '10', '--max-filesize', String(4 * 1024 * 1024), url,
    ]).then(pick)
  }

  const found = (hit: LrclibTrack): LrclibTrack => {
    clearLrclibMiss(artist, track)
    logEvent('lrclib', 'lyr', `${hit.syncedLyrics ? 'lyrics found' : 'instrumental'} #${hit.id}  ${hit.trackName} — ${hit.artistName}`)
    return hit
  }
  const miss = (): null => {
    recordLrclibMiss(artist, track)
    logEvent('lrclib', 'nolyr', `no lyrics found → cached 30d  "${track}" — "${artist}"`)
    return null
  }
  const candidates = lyricQueryCandidates(artist, track)
  const tryNext = (index: number, includeAlbum: boolean): Promise<LrclibTrack | null> => {
    if (index >= candidates.length) {
      // If nothing matched with the album filter applied, retry every candidate
      // once more without it — a mismatched album (deluxe/reissue/compilation)
      // shouldn't be able to hide a result the plain track+artist search would find.
      if (includeAlbum && album) return tryNext(0, false)
      return Promise.resolve(miss())
    }
    const candidate = candidates[index]
    return search(candidate.artist, candidate.track, includeAlbum)
      .then(hit => hit ? found(hit) : tryNext(index + 1, includeAlbum))
  }

  return tryNext(0, true)
    .catch((e: any) => {
      logEvent('lrclib', 'neterr', `network error / unreachable  "${track}" — "${artist}"`, String(e))
      return null
    })
}
