// Perf
import { loadSettings, UserSettings } from "./UserSettings"

const settings = loadSettings()

export const LOW_END: boolean = settings.lowEndDevice === true
export const LOW_END_LABEL = '-Low-end device enabled-'
export const REDUCED_MOTION: boolean = LOW_END || settings.reducedMotion === true

const MIN_INTERVAL_MS = 30_000
export function clampInterval(ms: number): number {
  return LOW_END ? Math.max(ms, MIN_INTERVAL_MS) : ms
}

export const LYRIC_SYNC_DEFAULT_US = 5_000
const LYRIC_SYNC_LOWEND_MS         = 300

function readLyricSyncUs(current: UserSettings): number {
  const value = Number(current.lyricSyncUs)
  if (Number.isFinite(value) && value > 0) return value
  return LYRIC_SYNC_DEFAULT_US
}

export const LYRIC_SYNC_MS: number =
  LOW_END ? LYRIC_SYNC_LOWEND_MS : Math.max(1, Math.round(readLyricSyncUs(settings) / 1000))
