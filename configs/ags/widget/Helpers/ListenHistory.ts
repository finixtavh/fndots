// Listen History
import GLib from "gi://GLib"
import Gio  from "gi://Gio"
import { dwarn } from "./DashLog"
import { AGS_STATE_DIR, cachePath, statePath } from "./Paths"

const HISTORY_FILE = statePath('ags', 'listen-history.json')
const LEGACY_HISTORY_FILE = cachePath('ags', 'listen-history.json')
const MAX_RECENT = 100
const MAX_LISTENED = 1000
const MAX_LABEL_LENGTH = 512
const MAX_PATH_LENGTH = 4096
const MAX_URL_LENGTH = 4096

export interface ListenEntry {
  title:         string
  artist:        string
  coverPath:     string
  totalSeconds:  number
  completePlays: number
  partialPlays:  number
}

export interface RecentEntry {
  title:    string
  artist:   string
  coverPath: string
  url:      string
  playedAt: number
}

interface HistoryData {
  listened: Record<string, ListenEntry>
  recent:   RecentEntry[]
}

let data: HistoryData = { listened: {}, recent: [] }
const changeSubs: Set<() => void> = new Set()

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function finiteNonNegative(value: unknown, integer = false): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  const normalized = Math.max(0, parsed)
  return integer ? Math.floor(normalized) : normalized
}

function pruneListened(): void {
  const entries = Object.entries(data.listened)
  if (entries.length <= MAX_LISTENED) return
  const recentKeys = new Set(data.recent.map(entry => listenKey(entry.title, entry.artist)))
  entries.sort(([leftKey, left], [rightKey, right]) =>
    Number(recentKeys.has(rightKey)) - Number(recentKeys.has(leftKey))
      || right.totalSeconds - left.totalSeconds
      || right.completePlays - left.completePlays)
  data.listened = Object.fromEntries(entries.slice(0, MAX_LISTENED))
}

function save(): boolean {
  try {
    pruneListened()
    GLib.mkdir_with_parents(AGS_STATE_DIR, 0o700)
    GLib.chmod(AGS_STATE_DIR, 0o700)
    const json  = JSON.stringify(data, null, 2)
    const bytes = new TextEncoder().encode(json)
    const file  = Gio.File.new_for_path(HISTORY_FILE)
    file.replace_contents(
      bytes, null, false,
      Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
      null,
    )
    GLib.chmod(HISTORY_FILE, 0o600)
    return true
  } catch (e) {
    dwarn('[ListenHistory] save failed:', e)
    return false
  }
}

function migrateRecentUrls(recent: RecentEntry[]): RecentEntry[] {
  return recent.map(r => {
    const u = r.url || ''
    if (!u) return r
    if (/youtube\.com\/watch\?v=|youtu\.be\//.test(u)) return r
    if (u.includes('/search')) return r
    const q = encodeURIComponent(`${r.title} ${r.artist}`.trim())
    let nu = `https://www.youtube.com/results?search_query=${q}`
    if      (u.includes('soundcloud.com')) nu = `https://soundcloud.com/search?q=${q}`
    else if (u.includes('spotify'))        nu = `https://open.spotify.com/search/${q}`
    else if (u.includes('bandcamp'))       nu = `https://bandcamp.com/search?q=${q}`
    return { ...r, url: nu }
  })
}

function load() {
  try {
    GLib.mkdir_with_parents(AGS_STATE_DIR, 0o700)
    GLib.chmod(AGS_STATE_DIR, 0o700)
    const hasCurrent = GLib.file_test(HISTORY_FILE, GLib.FileTest.EXISTS)
    const source = hasCurrent ? HISTORY_FILE : LEGACY_HISTORY_FILE
    if (hasCurrent) GLib.chmod(HISTORY_FILE, 0o600)
    const [ok, raw] = GLib.file_get_contents(source)
    if (ok) {
      const parsed = JSON.parse(new TextDecoder().decode(raw))
      const listened: Record<string, ListenEntry> = {}
      if (parsed?.listened && typeof parsed.listened === 'object' && !Array.isArray(parsed.listened)) {
        for (const candidate of Object.values(parsed.listened as Record<string, any>)) {
          if (!candidate || typeof candidate !== 'object') continue
          const title = boundedString(candidate.title, MAX_LABEL_LENGTH)
          if (!title) continue
          const artist = boundedString(candidate.artist, MAX_LABEL_LENGTH)
          listened[listenKey(title, artist)] = {
            title,
            artist,
            coverPath: boundedString(candidate.coverPath, MAX_PATH_LENGTH),
            totalSeconds: finiteNonNegative(candidate.totalSeconds),
            completePlays: finiteNonNegative(candidate.completePlays, true),
            partialPlays: finiteNonNegative(candidate.partialPlays, true),
          }
        }
      }
      const recent: RecentEntry[] = (Array.isArray(parsed?.recent) ? parsed.recent : [])
        .filter((candidate: any) => candidate && typeof candidate.title === 'string' && candidate.title)
        .slice(0, MAX_RECENT)
        .map((candidate: any) => ({
          title: boundedString(candidate.title, MAX_LABEL_LENGTH),
          artist: boundedString(candidate.artist, MAX_LABEL_LENGTH),
          coverPath: boundedString(candidate.coverPath, MAX_PATH_LENGTH),
          url: boundedString(candidate.url, MAX_URL_LENGTH),
          playedAt: finiteNonNegative(candidate.playedAt),
        }))
      const migrated = migrateRecentUrls(recent)
      data = { listened, recent: migrated }
      const importedLegacy = source === LEGACY_HISTORY_FILE
      const needsRewrite = importedLegacy
        || Object.keys(listened).length > MAX_LISTENED
        || migrated.some((entry, i) => entry.url !== recent[i]?.url)
      pruneListened()
      if (needsRewrite && save() && importedLegacy) {
        try { GLib.unlink(LEGACY_HISTORY_FILE) } catch (_) {}
      }
    }
  } catch (error) { dwarn('[ListenHistory] load failed:', error) }
}

function notifyChange() {
  changeSubs.forEach(cb => { try { cb() } catch (_) {} })
}

load()

export function subscribeHistory(cb: () => void): () => void {
  changeSubs.add(cb)
  return () => changeSubs.delete(cb)
}

export function getTopListened(n = 5): ListenEntry[] {
  return Object.values(data.listened)
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, n)
}

export function getRecent(n = 7): RecentEntry[] {
  return data.recent.slice(0, n)
}

function listenKey(title: string, artist: string): string {
  return `${title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`.slice(0, 2048)
}

export function saveProgress(
  title:     string,
  artist:    string,
  coverPath: string,
  url:       string,
  seconds:   number
): void {
  title = boundedString(title, MAX_LABEL_LENGTH)
  artist = boundedString(artist, MAX_LABEL_LENGTH)
  coverPath = boundedString(coverPath, MAX_PATH_LENGTH)
  url = boundedString(url, MAX_URL_LENGTH)
  if (!title) return

  const key = listenKey(title, artist)
  if (!data.listened[key]) {
    data.listened[key] = {
      title, artist, coverPath,
      totalSeconds: 0, completePlays: 0, partialPlays: 0,
    }
  }
  const entry = data.listened[key]
  if (seconds > 0) entry.totalSeconds += Math.round(seconds)
  if (coverPath) entry.coverPath = coverPath

  const existing = data.recent.find(r => listenKey(r.title, r.artist) === key)
  if (existing) {
    existing.playedAt  = Date.now()
    if (coverPath) existing.coverPath = coverPath
    if (url)       existing.url       = url
    data.recent = [existing, ...data.recent.filter(r => r !== existing)]
  } else {
    data.recent.unshift({ title, artist, coverPath, url, playedAt: Date.now() })
    data.recent = data.recent.slice(0, MAX_RECENT)
  }
  save()
  notifyChange()
}

export function flushSession(
  title:              string,
  artist:             string,
  coverPath:          string,
  url:                string,
  remainingSeconds:   number,
  sessionTotalSeconds: number,
  duration:           number
): void {
  title = boundedString(title, MAX_LABEL_LENGTH)
  artist = boundedString(artist, MAX_LABEL_LENGTH)
  coverPath = boundedString(coverPath, MAX_PATH_LENGTH)
  url = boundedString(url, MAX_URL_LENGTH)
  if (!title || sessionTotalSeconds < 1) return

  const key = listenKey(title, artist)
  if (!data.listened[key]) {
    data.listened[key] = {
      title, artist, coverPath,
      totalSeconds: 0, completePlays: 0, partialPlays: 0,
    }
  }
  const entry = data.listened[key]
  if (remainingSeconds > 0) entry.totalSeconds += Math.round(remainingSeconds)
  if (coverPath) entry.coverPath = coverPath

  const pct = duration > 0 ? sessionTotalSeconds / duration : 0
  if (pct >= 0.9) entry.completePlays++
  else            entry.partialPlays++

  data.recent = data.recent.filter(r => listenKey(r.title, r.artist) !== key)
  data.recent.unshift({ title, artist, coverPath, url, playedAt: Date.now() })
  data.recent = data.recent.slice(0, MAX_RECENT)

  save()
  notifyChange()
}

export function clearRecent(): void {
  data.recent = []
  save()
  notifyChange()
}

export function clearListened(): void {
  data.listened = {}
  save()
  notifyChange()
}
