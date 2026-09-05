// ListenTracker background history tracker
import AstalMpris from "gi://AstalMpris"
import GLib from "gi://GLib"
import { createBinding, createEffect } from "ags"
import { loadSettings } from "./UserSettings"
import { dwarn } from "./DashLog"
import { LOW_END } from "./Perf"
import { saveProgress, flushSession } from "./ListenHistory"
import {
  YTDLP_AVAILABLE,
  youtubeVideoId,
  watchUrl,
  checkIsMusic,
  getCachedResult,
} from "./YtDlp"
import {
  resolveCoverPath,
  cacheArtwork,
  buildSongId,
  selectChromaPresetForPlayer,
} from "../Bar/MusicBar"

let trackerStarted = false
let currentPlayerRef: AstalMpris.Player | null = null
const playerStatusSignals = new Map<AstalMpris.Player, number>()
const refreshRetryIds = new Set<number>()
let missingPlayerId: number | null = null

let trackTitle = ''
let trackArtist = ''
let trackIdentity = ''
let trackCoverPath = ''
let trackUrl = ''
let trackYtId = ''
let trackDuration = 0
let trackPlayedS = 0
let trackSessionS = 0
let trackIsMusic: boolean | null = true

const buildSearchUrl = (title: string, artist: string, pageUrl: string): string => {
  const q = encodeURIComponent(`${title} ${artist}`.trim())
  if (pageUrl.includes('soundcloud.com')) return `https://soundcloud.com/search?q=${q}`
  if (pageUrl.includes('spotify')) return `https://open.spotify.com/search/${q}`
  if (pageUrl.includes('bandcamp')) return `https://bandcamp.com/search?q=${q}`
  return `https://www.youtube.com/results?search_query=${q}`
}

const computeTrackUrl = (p: AstalMpris.Player, title: string, artist: string): { url: string; ytId: string } => {
  let pageUrl = ''
  try {
    const uv = p.get_meta('xesam:url')
    if (uv) pageUrl = String((uv as any).unpack?.() ?? '')
  } catch (_) {}
  const ytId = youtubeVideoId(pageUrl)
  const url = ytId ? watchUrl(ytId) : buildSearchUrl(title, artist, pageUrl)
  return { url, ytId: ytId ?? '' }
}

const captureTrackInfo = (player: AstalMpris.Player) => {
  trackTitle = player.title ?? ''
  trackArtist = player.artist ?? ''
  trackIdentity = buildSongId(player)

  if (!LOW_END) selectChromaPresetForPlayer(player)
  const rawCover = resolveCoverPath(player)
  trackCoverPath = rawCover ? cacheArtwork(rawCover, trackTitle, trackArtist) : ''
  trackDuration = player.length ?? 0
  trackPlayedS = 0
  trackSessionS = 0

  const u0 = computeTrackUrl(player, trackTitle, trackArtist)
  trackUrl = u0.url
  trackYtId = u0.ytId

  if (!trackTitle) {
    trackIsMusic = false
    return
  }

  const settings = loadSettings()
  const filterEnabled = settings.ytdlpMusicFilter !== false

  if (filterEnabled && YTDLP_AVAILABLE && trackYtId) {
    const ytWatchUrl = watchUrl(trackYtId)
    const cached = getCachedResult(ytWatchUrl)
    if (cached !== null) {
      trackIsMusic = cached
      if (cached) saveProgress(trackTitle, trackArtist, trackCoverPath, trackUrl, 0)
      return
    }
    trackIsMusic = null
    const capturedTitle = trackTitle
    const capturedArtist = trackArtist
    const capturedIdentity = trackIdentity
    checkIsMusic(ytWatchUrl).then((isMusic: boolean) => {
      if (
        trackIdentity !== capturedIdentity ||
        trackTitle !== capturedTitle ||
        trackArtist !== capturedArtist
      ) return
      trackIsMusic = isMusic
      if (isMusic) saveProgress(trackTitle, trackArtist, trackCoverPath, trackUrl, 0)
    })
  } else {
    trackIsMusic = true
    saveProgress(trackTitle, trackArtist, trackCoverPath, trackUrl, 0)
  }
}

const flushTrack = () => {
  if (trackTitle && trackIsMusic === true && trackSessionS >= 1) {
    flushSession(
      trackTitle,
      trackArtist,
      trackCoverPath,
      trackUrl,
      trackPlayedS,
      trackSessionS,
      trackDuration,
    )
  }
  trackPlayedS = 0
  trackSessionS = 0
}

export function ensureListenTrackerStarted(): void {
  if (trackerStarted) return
  trackerStarted = true

  const mpris = AstalMpris.get_default()

  const cancelMissingPlayerGrace = () => {
    if (missingPlayerId === null) return
    GLib.source_remove(missingPlayerId)
    missingPlayerId = null
  }

  const refreshPlayer = (forceMissing = false) => {
    try {
      const players: AstalMpris.Player[] = mpris.get_players() as any ?? []
      if (players.length === 0 && currentPlayerRef !== null && !forceMissing) {
        if (missingPlayerId === null) {
          missingPlayerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            missingPlayerId = null
            refreshPlayer(true)
            return GLib.SOURCE_REMOVE
          })
        }
        return
      }
      if (players.length > 0) cancelMissingPlayerGrace()
      const available = new Set(players)
      for (const [player, signalId] of playerStatusSignals) {
        if (available.has(player)) continue
        try { player.disconnect(signalId) } catch (_) {}
        playerStatusSignals.delete(player)
      }
      for (const player of players) {
        if (playerStatusSignals.has(player)) continue
        try {
          playerStatusSignals.set(player, player.connect('notify::playback-status', () => refreshPlayer()))
        } catch (_) {}
      }
      const isPlaying = (player: AstalMpris.Player | null): boolean =>
        player?.playbackStatus === AstalMpris.PlaybackStatus.PLAYING
      const stablePlayers = [...players].sort((left, right) =>
        String((left as any).busName ?? (left as any).bus_name ?? '')
          .localeCompare(String((right as any).busName ?? (right as any).bus_name ?? '')))
      const currentAvailable = currentPlayerRef !== null && available.has(currentPlayerRef)
      const next = currentAvailable && isPlaying(currentPlayerRef)
        ? currentPlayerRef
        : stablePlayers.find(isPlaying)
          ?? (currentAvailable ? currentPlayerRef : stablePlayers[0] ?? null)
      if (next === currentPlayerRef) return

      if (currentPlayerRef && next !== currentPlayerRef) {
        flushTrack()
      }
      currentPlayerRef = next
      if (next) {
        captureTrackInfo(next)
      } else {
        trackTitle = ''
        trackArtist = ''
        trackIdentity = ''
        trackPlayedS = 0
        trackSessionS = 0
      }
    } catch (e) {
      dwarn('[ListenTracker] refresh error:', e)
    }
  }

  try { mpris.connect('player-added', () => refreshPlayer()) } catch (_) {}
  try { mpris.connect('player-closed', () => refreshPlayer()) } catch (_) {}
  createBinding(mpris, 'players').subscribe(() => refreshPlayer())

  refreshPlayer()

  for (const delay of [400, 1800]) {
    let id = 0
    id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      refreshRetryIds.delete(id)
      if (currentPlayerRef === null) refreshPlayer()
      return GLib.SOURCE_REMOVE
    })
    refreshRetryIds.add(id)
  }

  // 1-second interval to accumulate play time
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    const player = currentPlayerRef
    if (player) {
      const curTitle = player.title ?? ''
      const curIdentity = buildSongId(player)
      if (curTitle && curIdentity !== trackIdentity) {
        flushTrack()
        captureTrackInfo(player)
      } else if (curTitle) {
        const u = computeTrackUrl(player, trackTitle, trackArtist)
        if (u.url && u.url !== trackUrl) {
          trackUrl = u.url
          trackYtId = u.ytId
          if (trackIsMusic === true) {
            saveProgress(trackTitle, trackArtist, trackCoverPath, trackUrl, 0)
          }
        }
      }

      if (
        player.playbackStatus === AstalMpris.PlaybackStatus.PLAYING &&
        trackIsMusic !== false
      ) {
        trackPlayedS++
        trackSessionS++
        const len = player.length
        if (len > 0) trackDuration = len
      }
    }
    return GLib.SOURCE_CONTINUE
  })

  // Periodic save interval
  const settings0 = loadSettings()
  const saveIntervalS = Math.max(15, Math.min(300, Number(settings0.historyIntervalS) || 30))
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, saveIntervalS * 1000, () => {
    if (trackTitle && trackIsMusic === true && trackPlayedS >= 1) {
      saveProgress(trackTitle, trackArtist, trackCoverPath, trackUrl, trackPlayedS)
      trackPlayedS = 0
    }
    return GLib.SOURCE_CONTINUE
  })
}
