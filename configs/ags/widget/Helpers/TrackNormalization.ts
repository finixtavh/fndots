// Track Normalization
const NOISE_TAG = /\s*[\[(（【]\s*(?:official\s+(?:music\s+)?video|official\s+audio|lyrics?|lyric\s+video|visuali[sz]er|remaster(?:ed)?(?:\s+\d{4})?|live(?:\s+at|\s+from)?[^\])）】]*|radio\s+edit|explicit|sped\s*up|slowed(?:\s*\+\s*reverb)?|nightcore|karaoke|hd|4k)\s*[\])）】]/gi
const PROVIDER_SUFFIX = /\s*[-–\u2014|]\s*(?:YouTube(?:\s+Music)?|SoundCloud|Spotify|Vimeo|Bandcamp|Topic)\s*$/i

export function normalizeText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[‐‑‒–\u2014―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanArtist(value: string): string {
  return normalizeText(value)
    .replace(/\s*[-–\u2014|]\s*Topic\s*$/i, '')
    .replace(/\s*VEVO\s*$/i, '')
    .replace(/\s*\((?:official|music)\)\s*$/i, '')
    .trim()
}

export function cleanTrack(value: string, artist = ''): string {
  let track = normalizeText(value)
    .replace(/^\s*(?:\d{1,3}[.)-]\s*)/, '')
    .replace(PROVIDER_SUFFIX, '')
    .replace(NOISE_TAG, '')
  const escaped = cleanArtist(artist).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (escaped) track = track.replace(new RegExp(`^${escaped}\\s*[-:|]\\s*`, 'i'), '')
  return normalizeText(track)
}

export function lyricQueryCandidates(artist: string, track: string): Array<{ artist: string; track: string }> {
  const rawArtist = normalizeText(artist)
  const rawTrack = normalizeText(track)
  const tidyArtist = cleanArtist(rawArtist)
  const tidyTrack = cleanTrack(rawTrack, rawArtist)
  const noFeature = normalizeText(tidyTrack.replace(/\s+(?:feat\.?|ft\.?)\s+.+$/i, ''))
  const candidates = [
    { artist: rawArtist, track: rawTrack },
    { artist: rawArtist, track: tidyTrack },
    { artist: tidyArtist, track: rawTrack },
    { artist: tidyArtist, track: tidyTrack },
    { artist: tidyArtist, track: noFeature },
  ]
  const seen = new Set<string>()
  return candidates.filter(candidate => {
    if (!candidate.artist || !candidate.track) return false
    const key = `${candidate.artist.toLocaleLowerCase()}\u0000${candidate.track.toLocaleLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 6)
}

export function normalizedTrackKey(artist: string, track: string): string {
  return `${cleanTrack(track, artist).toLocaleLowerCase()}|${cleanArtist(artist).toLocaleLowerCase()}`
}
