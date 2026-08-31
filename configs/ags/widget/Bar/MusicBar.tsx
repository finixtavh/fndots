// Music Bar
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import { derr, dwarn } from "../Helpers/DashLog"
import { FN_DEBUG } from "../Helpers/FnLogCollector"
import GdkPixbuf from "gi://GdkPixbuf"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import AstalMpris from "gi://AstalMpris"
import Pango from "gi://Pango"
import PangoCairo from "gi://PangoCairo"
import { createBinding, onCleanup, createState, createEffect } from "ags"
import { execAsync } from "ags/process"
import { NUM_BARS, cavaData, ensureCavaStarted, REFRESH_HZ, subscribeCavaRefresh } from "../Helpers/cava"
import { LOW_END, LOW_END_LABEL, LYRIC_SYNC_MS } from "../Helpers/Perf"
import { flushSession, saveProgress, subscribeHistory, getTopListened, getRecent } from "../Helpers/ListenHistory"
import { ensureListenTrackerStarted } from "../Helpers/ListenTracker"
import { IconImg, iconImage, setBarIcon, IC } from "../Helpers/Icons"
import type { ListenEntry, RecentEntry } from "../Helpers/ListenHistory"
import { YTDLP_AVAILABLE, youtubeVideoId, watchUrl, checkIsMusic, getCachedResult } from "../Helpers/YtDlp"
import { loadSettings } from "../Helpers/UserSettings"
import { registerMusicBarController } from "../Helpers/MusicBarVisibility"
import { fetchLrclib } from "../Helpers/Lyrics"
import { registerFlyout } from "../Helpers/FlyoutState"
import { CONFIG_HOME, cachePath, AGS_CONFIG_DIR } from "../Helpers/Paths"

const CHROMA_REPO_DIR     = `${GLib.get_home_dir()}/fn-apps/chroma`
const CHROMA_DOTFILES_PRESET = `${CONFIG_HOME}/hypr/chroma/fn-dots.toml`
const CHROMA_PRESET_DIR   = `${CONFIG_HOME}/hypr/chroma/presets`
const CHROMA_ART_SHADER_DIR = cachePath('ags', 'chroma')
const CHROMA_ART_SHADER = `${CHROMA_ART_SHADER_DIR}/reactive-suite-art.wgsl`
const CHROMA_REACTIVE_PRESETS = [
  '01-aurora-ribbons', '02-orbital-rings', '03-liquid-lattice', '04-diagonal-rain',
  '05-breathing-dunes', '06-vortex-petals', '07-metaball-drift', '08-sonar-arcs',
  '09-checker-drift', '10-soft-constellation', '11-twin-helix', '12-rippled-tunnel',
  '13-fractured-glass', '14-magnetic-field', '15-tidal-bands', '16-rotating-diamonds',
  '17-nebula-wisps', '18-radar-sweep', '19-slow-kaleidoscope', '20-electric-veins',
] as const
const CHROMA_COLS          = 84
const CHROMA_ROWS          = 26
const CHROMA_FPS           = 30

const CHROMA_CORNER_RADIUS  = 14

const CHROMA_FONT_FAMILY =
  'JetBrainsMono Nerd Font Mono, Symbols Nerd Font Mono, Noto Sans Symbols 2, Noto Sans Mono, DejaVu Sans Mono'

type ChromaCell = { ch: string; r: number; g: number; b: number }
type ChromaFrame = ChromaCell[][]

let _chromaTrackKey  = ''
let _chromaPreset    = ''
const _chromaPresetSubs = new Set<(preset: string) => void>()
let _chromaArtworkPaletteEnabled = loadSettings().chromaArtworkPalette !== false
const _chromaArtworkPaletteSubs = new Set<(enabled: boolean) => void>()
let _chromaArtworkPaletteWarned = false

export function setChromaArtworkPaletteEnabled(enabled: boolean): void {
  if (_chromaArtworkPaletteEnabled === enabled) return
  _chromaArtworkPaletteEnabled = enabled
  _chromaArtworkPaletteSubs.forEach(cb => { try { cb(enabled) } catch (_) {} })
}

function subscribeChromaArtworkPalette(cb: (enabled: boolean) => void): () => void {
  _chromaArtworkPaletteSubs.add(cb)
  return () => _chromaArtworkPaletteSubs.delete(cb)
}

function chromaBinary(): string {
  const home = GLib.get_home_dir()
  const candidates = [
    `${CHROMA_REPO_DIR}/target/release/chroma`,
    `${CHROMA_REPO_DIR}/target/debug/chroma`,
    `${home}/.local/bin/chroma`,
    `${home}/.cargo/bin/chroma`,
    GLib.find_program_in_path('chroma') ?? '',
  ]
  return candidates.find(path => path && GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE)) ?? ''
}

function chromaShaderForPreset(preset: string): string {
  if (!preset.endsWith('.toml')) return ''
  const shader = `${preset.slice(0, -'.toml'.length)}.wgsl`
  if (GLib.file_test(shader, GLib.FileTest.IS_REGULAR)) return shader
  const shared = GLib.build_filenamev([GLib.path_get_dirname(preset), 'reactive-suite.wgsl'])
  return GLib.file_test(shared, GLib.FileTest.IS_REGULAR) ? shared : ''
}

function createArtworkPaletteShader(baseShader: string, colors: RGB[]): string {
  if (!baseShader || colors.length === 0) return ''
  try {
    const [ok, raw] = GLib.file_get_contents(baseShader)
    if (!ok) return ''
    const lines = new TextDecoder().decode(raw).split('\n')
    const replaceLine = (name: string, value: string): boolean => {
      const prefix = `const ${name}:`
      const index = lines.findIndex(line => line.startsWith(prefix))
      if (index < 0) return false
      lines[index] = value
      return true
    }

    const count = Math.max(1, Math.min(16, colors.length))
    if (!replaceLine('ART_PALETTE_ENABLED', 'const ART_PALETTE_ENABLED: bool = true;')) return ''
    if (!replaceLine('ART_PALETTE_COUNT', `const ART_PALETTE_COUNT: u32 = ${count}u;`)) return ''
    for (let i = 0; i < 16; i++) {
      const color = colors[i % count]
      const value = color.map(channel => clamp01(channel).toFixed(6)).join(', ')
      if (!replaceLine(
        `ART_COLOR_${i}`,
        `const ART_COLOR_${i}: vec3<f32> = vec3<f32>(${value});`,
      )) return ''
    }

    GLib.mkdir_with_parents(CHROMA_ART_SHADER_DIR, 0o700)
    GLib.chmod(CHROMA_ART_SHADER_DIR, 0o700)
    Gio.File.new_for_path(CHROMA_ART_SHADER).replace_contents(
      new TextEncoder().encode(lines.join('\n')),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
      null,
    )
    GLib.chmod(CHROMA_ART_SHADER, 0o600)
    return CHROMA_ART_SHADER
  } catch (error) {
    if (!_chromaArtworkPaletteWarned) {
      _chromaArtworkPaletteWarned = true
      dwarn('[chroma] Could not build artwork palette shader:', error)
    }
    return ''
  }
}

function chromaShaderForPlayer(
  preset: string,
  player: AstalMpris.Player,
): { shader: string; artworkPath: string } {
  const baseShader = chromaShaderForPreset(preset)
  if (!_chromaArtworkPaletteEnabled || !baseShader) {
    return { shader: baseShader, artworkPath: '' }
  }

  const artworkPath = resolveCoverPath(player)
  if (!artworkPath || !GLib.file_test(artworkPath, GLib.FileTest.IS_REGULAR)) {
    return { shader: baseShader, artworkPath: '' }
  }
  const colors = extractArtColors(artworkPath)?.palette ?? []
  const generated = createArtworkPaletteShader(baseShader, colors)
  return generated
    ? { shader: generated, artworkPath }
    : { shader: baseShader, artworkPath: '' }
}

function availableChromaPresets(): string[] {
  return CHROMA_REACTIVE_PRESETS
    .map(name => GLib.build_filenamev([CHROMA_PRESET_DIR, `${name}.toml`]))
    .filter(path => GLib.file_test(path, GLib.FileTest.IS_REGULAR))
}

function subscribeChromaPreset(cb: (preset: string) => void): () => void {
  _chromaPresetSubs.add(cb)
  return () => _chromaPresetSubs.delete(cb)
}

export function selectChromaPresetForPlayer(player: AstalMpris.Player): string {
  if (LOW_END) return ''
  const title = player.title ?? ''
  if (!title) return _chromaPreset
  const key = `norm:${normalizeSongStr(title)}|${normalizeSongStr(player.artist ?? '')}`
  if (key === _chromaTrackKey) return _chromaPreset

  _chromaTrackKey = key
  const available = availableChromaPresets()
  const alternatives = available.filter(preset => preset !== _chromaPreset)
  const choices = alternatives.length ? alternatives : available
  const nextPreset = choices.length
    ? choices[GLib.random_int_range(0, choices.length)]
    : GLib.file_test(CHROMA_DOTFILES_PRESET, GLib.FileTest.IS_REGULAR)
      ? CHROMA_DOTFILES_PRESET
      : ''
  if (nextPreset === _chromaPreset) return _chromaPreset
  _chromaPreset = nextPreset
  _chromaPresetSubs.forEach(cb => { try { cb(_chromaPreset) } catch (_) {} })
  return _chromaPreset
}

const ANSI_16: Array<[number, number, number]> = [
  [0, 0, 0],       [205, 49, 49],  [13, 188, 121], [229, 229, 16],
  [36, 114, 200],  [188, 63, 188], [17, 168, 205], [229, 229, 229],
  [102, 102, 102], [241, 76, 76],  [35, 209, 139], [245, 245, 67],
  [59, 142, 234],  [214, 112, 214],[41, 184, 219], [255, 255, 255],
]

function parseChromaAnsiLine(raw: string): ChromaCell[] {
  const cells: ChromaCell[] = []
  let fg: [number, number, number] = [0x89, 0xb1, 0x9e]
  let i = 0

  while (i < raw.length && cells.length < CHROMA_COLS) {
    if (raw.charCodeAt(i) === 0x1b) {
      const match = raw.slice(i).match(/^\x1b\[([0-9;:]*)?([A-Za-z])/)
      if (match) {
        if (match[2] === 'm') {
          const params = (match[1] || '0').replace(/:/g, ';').split(';').map(Number)
          for (let n = 0; n < params.length; n++) {
            const code = Number.isFinite(params[n]) ? params[n] : 0
            if (code === 0 || code === 39) fg = [0x89, 0xb1, 0x9e]
            else if (code >= 30 && code <= 37) fg = ANSI_16[code - 30]
            else if (code >= 90 && code <= 97) fg = ANSI_16[8 + code - 90]
            else if (code === 38 && params[n + 1] === 2 && params.length >= n + 5) {
              fg = [params[n + 2] || 0, params[n + 3] || 0, params[n + 4] || 0]
              n += 4
            } else if (code === 38 && params[n + 1] === 5 && params.length >= n + 3) {
              const idx = Math.max(0, Math.min(255, params[n + 2] || 0))
              if (idx < 16) fg = ANSI_16[idx]
              else if (idx >= 232) {
                const v = 8 + (idx - 232) * 10
                fg = [v, v, v]
              } else {
                const q = idx - 16
                const cv = (v: number) => v === 0 ? 0 : 55 + v * 40
                fg = [cv(Math.floor(q / 36)), cv(Math.floor((q % 36) / 6)), cv(q % 6)]
              }
              n += 2
            }
          }
        }
        i += match[0].length
        continue
      }
    }

    const cp = raw.codePointAt(i)
    if (cp == null) break
    const ch = String.fromCodePoint(cp)
    i += ch.length
    if (ch === '\r' || ch === '\n') continue
    cells.push({ ch, r: fg[0], g: fg[1], b: fg[2] })
  }

  while (cells.length < CHROMA_COLS) cells.push({ ch: ' ', r: 0, g: 0, b: 0 })
  return cells
}

function drawChromaFrame(cr: any, dw: number, dh: number, frame: ChromaFrame): void {
  if (!frame.length || dw <= 0 || dh <= 0) return

  const cellW = dw / CHROMA_COLS
  const cellH = dh / CHROMA_ROWS
  const fontPx = Math.max(6, cellH * 0.88)

  cr.save()
  cr.rectangle(0, 0, dw, dh)
  cr.clip()

  const layout = PangoCairo.create_layout(cr)
  const font = new Pango.FontDescription()
  font.set_family(CHROMA_FONT_FAMILY)
  font.set_absolute_size(fontPx * Pango.SCALE)
  layout.set_font_description(font)
  layout.set_single_paragraph_mode(true)

  let lr = -1, lg = -1, lb = -1
  for (let y = 0; y < Math.min(CHROMA_ROWS, frame.length); y++) {
    const line = frame[y]

    for (let x = 0; x < Math.min(CHROMA_COLS, line.length); x++) {
      const cell = line[x]
      if (!cell || cell.ch === ' ') continue

      if (cell.r !== lr || cell.g !== lg || cell.b !== lb) {
        lr = cell.r
        lg = cell.g
        lb = cell.b
        cr.setSourceRGB(lr / 255, lg / 255, lb / 255)
      }

      layout.set_text(cell.ch, -1)
      const [, glyphH] = layout.get_pixel_size()

      cr.moveTo(
        x * cellW,
        y * cellH + Math.max(0, (cellH - glyphH) / 2),
      )
      PangoCairo.show_layout(cr, layout)
    }
  }

  cr.restore()
}

function clipChromaTopCorners(cr: any, dw: number, dh: number): void {
  const radius = Math.min(CHROMA_CORNER_RADIUS, dw / 2, dh)
  if (radius <= 0) return

  cr.newPath()
  cr.moveTo(radius, 0)
  cr.lineTo(dw - radius, 0)
  cr.arc(dw - radius, radius, radius, -Math.PI / 2, 0)
  cr.lineTo(dw, dh)
  cr.lineTo(0, dh)
  cr.lineTo(0, radius)
  cr.arc(radius, radius, radius, Math.PI, Math.PI * 1.5)
  cr.closePath()
  cr.clip()
}

function attachChromaBackground(topArea: Gtk.Box, player: AstalMpris.Player): void {
  if (LOW_END) return

  let alive   = true
  let mapped  = false
  let proc: Gio.Subprocess | null = null
  let streamCancel: Gio.Cancellable | null = null
  let preset  = selectChromaPresetForPlayer(player)
  let pending: ChromaFrame = []
  let frame: ChromaFrame   = []
  let warned = false
  let activeArtworkPath = ''
  let observedArtworkPath = resolveCoverPath(player)
  const paletteRetryIds = new Set<number>()

  const clearPaletteRetries = () => {
    paletteRetryIds.forEach(id => { try { GLib.source_remove(id) } catch (_) {} })
    paletteRetryIds.clear()
  }

  const stop = () => {
    pending = []
    const stopped = proc
    proc = null
    try { streamCancel?.cancel() } catch (_) {}
    streamCancel = null
    if (!stopped) return
    try { stopped.send_signal(15) }
    catch (_) { try { stopped.force_exit() } catch (_) {} }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
      try { if (!stopped.get_if_exited()) stopped.force_exit() } catch (_) {}
      return GLib.SOURCE_REMOVE
    })
  }

  const start = () => {
    stop()
    if (!alive || !mapped || !preset) return
    const bin = chromaBinary()
    if (!bin) {
      if (!warned) {
        warned = true
        dwarn('[chroma] Binary not found. Build ~/fn-apps/chroma or install chroma in PATH.')
      }
      return
    }

    try {
      const command = [
        bin,
        '--stream', `${CHROMA_COLS}x${CHROMA_ROWS}`,
        '--fps', String(CHROMA_FPS),
        '--background-color', '121212',
        '--config', preset,
      ]
      const shaderSelection = chromaShaderForPlayer(preset, player)
      activeArtworkPath = shaderSelection.artworkPath
      const shader = shaderSelection.shader
      if (shader) command.push('--custom-shader', shader)

      const spawned = Gio.Subprocess.new(
        command,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      )
      proc = spawned
      const cancel = new Gio.Cancellable()
      streamCancel = cancel
      const stdout = spawned.get_stdout_pipe()
      const stderr = spawned.get_stderr_pipe()
      if (!stdout) throw new Error('Chroma did not expose stdout')
      const outStream = Gio.DataInputStream.new(stdout)
      const readOutput = () => {
        if (cancel.is_cancelled() || proc !== spawned) return
        outStream.read_line_async(GLib.PRIORITY_DEFAULT, cancel, (_stream, result) => {
          if (cancel.is_cancelled() || proc !== spawned) return
          try {
            const [line] = outStream.read_line_finish_utf8(result)
            if (line === null) return
            const clean = line.replace(/\r$/, '')
            if (clean === '') {
              if (pending.length) {
                frame = pending.slice(0, CHROMA_ROWS)
                pending = []
                try { topArea.queue_draw() } catch (_) {}
              }
            } else {

              pending.push(parseChromaAnsiLine(clean))
              if (pending.length >= CHROMA_ROWS) {
                frame = pending.slice(0, CHROMA_ROWS)
                pending = []
                try { topArea.queue_draw() } catch (_) {}
              }
            }
            readOutput()
          } catch (_) {}
        })
      }
      readOutput()

      if (stderr) {
        const errStream = Gio.DataInputStream.new(stderr)
        const readError = () => {
          if (cancel.is_cancelled() || proc !== spawned) return
          errStream.read_line_async(GLib.PRIORITY_LOW, cancel, (_stream, result) => {
            if (cancel.is_cancelled() || proc !== spawned) return
            try {
              const [line] = errStream.read_line_finish_utf8(result)
              if (line === null) return
              if (!warned && line.trim()) {
                warned = true
                dwarn('[chroma]', line.trim())
              }
              readError()
            } catch (_) {}
          })
        }
        readError()
      }
      spawned.wait_async(null, (_process, result) => {
        try { spawned.wait_finish(result) } catch (_) {}
        if (proc === spawned) { proc = null; streamCancel = null }
      })
    } catch (e) {
      if (!warned) { warned = true; dwarn('[chroma] Failed to start:', e) }
    }
  }

  const unsubscribe = subscribeChromaPreset(nextPreset => {
    preset = nextPreset
    frame = []
    if (mapped) start()
    else try { topArea.queue_draw() } catch (_) {}
  })
  const unsubscribeArtworkPalette = subscribeChromaArtworkPalette(() => {
    activeArtworkPath = ''
    if (mapped) start()
  })
  const onArtworkChanged = () => {
    const nextArtworkPath = resolveCoverPath(player)
    if (nextArtworkPath === observedArtworkPath) return
    observedArtworkPath = nextArtworkPath
    activeArtworkPath = ''
    if (_chromaArtworkPaletteEnabled && mapped) start()
  }
  const unsubscribeCoverArt = createBinding(player, 'coverArt').subscribe(onArtworkChanged)
  const unsubscribeArtUrl = createBinding(player, 'artUrl').subscribe(onArtworkChanged)

  topArea.connect('draw', (_w: any, cr: any) => {
    const dw = topArea.get_allocated_width(), dh = topArea.get_allocated_height()
    cr.save()
    clipChromaTopCorners(cr, dw, dh)
    drawChromaFrame(cr, dw, dh, frame)
    cr.setSourceRGBA(0x12 / 255, 0x12 / 255, 0x12 / 255, 0.60)
    cr.rectangle(0, 0, dw, dh)
    cr.fill()
    cr.restore()
    return false
  })

  topArea.connect('map', () => {
    mapped = true
    start()
    clearPaletteRetries()
    for (const ms of [250, 800, 2000]) {
      let id = 0
      id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        paletteRetryIds.delete(id)
        if (!_chromaArtworkPaletteEnabled || !mapped) return GLib.SOURCE_REMOVE
        const artworkPath = resolveCoverPath(player)
        if (artworkPath && artworkPath !== activeArtworkPath
            && GLib.file_test(artworkPath, GLib.FileTest.IS_REGULAR)) start()
        return GLib.SOURCE_REMOVE
      })
      paletteRetryIds.add(id)
    }
  })
  topArea.connect('unmap', () => {
    mapped = false
    clearPaletteRetries()
    stop()
  })
  topArea.connect('destroy', () => {
    alive = false
    mapped = false
    unsubscribe()
    unsubscribeArtworkPalette()
    unsubscribeCoverArt()
    unsubscribeArtUrl()
    clearPaletteRetries()
    stop()
    frame = []
  })
}

type RGB = [number, number, number]
const SPEC_DARK_DEFAULT:   RGB = [0x33 / 255, 0x47 / 255, 0x3d / 255]
const SPEC_BRIGHT_DEFAULT: RGB = [0x99 / 255, 0xc6 / 255, 0xb1 / 255]
let SPEC_DARK:   RGB = [...SPEC_DARK_DEFAULT]
let SPEC_BRIGHT: RGB = [...SPEC_BRIGHT_DEFAULT]

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

interface ArtworkColors {
  dark: RGB
  dominant: RGB
  palette: RGB[]
}

interface PaletteCandidate {
  rgb: RGB
  score: number
}

function extractArtColors(path: string): ArtworkColors | null {
  try {
    const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 48, 48, true)
    const px = pb.get_pixels()
    const w  = pb.get_width(), h = pb.get_height()
    const ch = pb.get_n_channels()
    const rs = pb.get_rowstride()
    const hasAlpha = pb.get_has_alpha()
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = y * rs + x * ch
        if (hasAlpha && px[o + 3] < 128) continue
        const r = px[o], g = px[o + 1], b = px[o + 2]
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
        let e = buckets.get(key)
        if (!e) { e = { r: 0, g: 0, b: 0, n: 0 }; buckets.set(key, e) }
        e.r += r; e.g += g; e.b += b; e.n++
      }
    }
    if (!buckets.size) return null
    let total = 0
    for (const e of buckets.values()) total += e.n
    const minCount = Math.max(2, total * 0.01)
    let domScored: RGB | null = null, domScore = -1
    let domFreq:   RGB | null = null, domFreqN = -1
    let dark: RGB | null = null, darkLum = Infinity
    const paletteCandidates: PaletteCandidate[] = []
    for (const e of buckets.values()) {
      const ar = e.r / e.n, ag = e.g / e.n, ab = e.b / e.n
      if (e.n >= minCount) {
        const lum = 0.299 * ar + 0.587 * ag + 0.114 * ab
        if (lum < darkLum) { darkLum = lum; dark = [ar, ag, ab] }
      }
      const L    = (0.299 * ar + 0.587 * ag + 0.114 * ab) / 255
      const mx   = Math.max(ar, ag, ab), mn = Math.min(ar, ag, ab)
      const S    = mx > 0 ? (mx - mn) / mx : 0
      const lumF = clamp01((L - 0.12) / 0.35) * clamp01((0.90 - L) / 0.18)
      const satF = 0.35 + 0.65 * S
      const washed = L > 0.82 && S < 0.18
      const score = washed ? 0 : e.n * lumF * satF
      if (score > domScore) { domScore = score; domScored = [ar, ag, ab] }
      if (e.n > domFreqN)   { domFreqN = e.n; domFreq = [ar, ag, ab] }
      if (score > 0) paletteCandidates.push({ rgb: [ar, ag, ab], score })
    }
    if (!domFreq) return null
    if (!dark) dark = domFreq
    let dom = (domScored && domScore > 0) ? domScored : domFreq
    dom = clampLumBand(dom, 0.30, 0.70)
    return {
      dark:     [dark[0] / 255, dark[1] / 255, dark[2] / 255],
      dominant: [dom[0]  / 255, dom[1]  / 255, dom[2]  / 255],
      palette: buildArtworkPalette(paletteCandidates, dom, dark),
    }
  } catch (_) { return null }
}

function rgbDistance(left: RGB, right: RGB): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2])
    / (255 * Math.sqrt(3))
}

function rgbHue(rgb: RGB): number {
  const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const delta = mx - mn
  if (delta <= 0.0001) return 0
  let hue = mx === r
    ? ((g - b) / delta) % 6
    : mx === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4
  hue /= 6
  return hue < 0 ? hue + 1 : hue
}

function mixRgb(left: RGB, right: RGB, amount: number): RGB {
  return [
    left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount,
  ]
}

function buildArtworkPalette(
  candidates: PaletteCandidate[],
  dominant: RGB,
  darkest: RGB,
): RGB[] {
  const selected: RGB[] = []
  const addIfDistinct = (rgb: RGB, minDistance: number) => {
    const banded = clampLumBand(rgb, 0.30, 0.70)
    if (selected.some(color => rgbDistance(color, banded) < Math.max(0.002, minDistance))) return
    selected.push(banded)
  }

  addIfDistinct(dominant, 0)
  addIfDistinct(darkest, 0.10)
  const ranked = [...candidates].sort((left, right) => right.score - left.score)
  for (const distance of [0.26, 0.18, 0.12, 0.07, 0.03, 0]) {
    for (const candidate of ranked) {
      if (selected.length >= 16) break
      addIfDistinct(candidate.rgb, distance)
    }
    if (selected.length >= 16) break
  }

  selected.sort((left, right) => rgbHue(left) - rgbHue(right))
  if (selected.length === 1) {
    const base = selected[0]
    return Array.from({ length: 16 }, (_, index) => {
      const targetLuminance = 0.30 + (index / 15) * 0.40
      return clampLumBand(base, targetLuminance, targetLuminance)
        .map(channel => channel / 255) as RGB
    })
  }

  const palette = Array.from({ length: 16 }, (_, index) => {
    const position = (index / 16) * selected.length
    const first = Math.floor(position) % selected.length
    const second = (first + 1) % selected.length
    const mixed = mixRgb(selected[first], selected[second], position - Math.floor(position))
    return clampLumBand(mixed, 0.30, 0.70)
      .map(channel => channel / 255) as RGB
  })
  return palette
}

function clampLumBand(rgb: RGB, loL: number, hiL: number): RGB {
  const [r, g, b] = rgb
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (L <= 0.02) return [SPEC_BRIGHT_DEFAULT[0] * 255, SPEC_BRIGHT_DEFAULT[1] * 255, SPEC_BRIGHT_DEFAULT[2] * 255]
  const target = L < loL ? loL : L > hiL ? hiL : L
  if (target === L) return rgb
  const f = target / L
  return [Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f)]
}

function applyArtSpectrum(path: string): void {
  const c = path ? extractArtColors(path) : null
  if (!c) {
    SPEC_DARK   = [...SPEC_DARK_DEFAULT]
    SPEC_BRIGHT = [...SPEC_BRIGHT_DEFAULT]
    return
  }
  SPEC_DARK   = [clamp01(c.dark[0] * 0.80), clamp01(c.dark[1] * 0.80), clamp01(c.dark[2] * 0.80)]

  SPEC_BRIGHT = [clamp01(c.dominant[0]), clamp01(c.dominant[1]), clamp01(c.dominant[2])]
}

function drawLevelSpectrum(cr: any, dw: number, dh: number, barCount: number): void {
  const step = dw / barCount
  const bw   = Math.max(2, step - 2)
  for (let j = 0; j < barCount; j++) {

    const t     = barCount === NUM_BARS ? j : (j / (barCount - 1)) * (NUM_BARS - 1)
    const i0    = Math.floor(t)
    const i1    = Math.min(NUM_BARS - 1, i0 + 1)
    const frac  = t - i0
    const v     = (cavaData.bars[i0] ?? 0) * (1 - frac) + (cavaData.bars[i1] ?? 0) * frac
    const level = Math.min(1, v / 255)
    const bh    = Math.max(2, Math.round(level * dh))

    cr.setSourceRGB(
      SPEC_DARK[0] + (SPEC_BRIGHT[0] - SPEC_DARK[0]) * level,
      SPEC_DARK[1] + (SPEC_BRIGHT[1] - SPEC_DARK[1]) * level,
      SPEC_DARK[2] + (SPEC_BRIGHT[2] - SPEC_DARK[2]) * level,
    )
    cr.rectangle(j * step, dh - bh, bw, bh)
    cr.fill()
  }
}

function drawAsleepDashes(cr: any, dw: number, dh: number): void {
  const layout = PangoCairo.create_layout(cr)
  layout.set_font_description(Pango.FontDescription.from_string('Italic 12'))
  layout.set_text('--', -1)
  const [tw, th] = layout.get_pixel_size()
  cr.setSourceRGBA(0.75, 0.78, 0.76, 0.45)
  cr.moveTo((dw - tw) / 2, (dh - th) / 2)
  PangoCairo.show_layout(cr, layout)
}

function drawLowEndText(cr: any, dw: number, dh: number): void {
  const layout = PangoCairo.create_layout(cr)
  layout.set_font_description(Pango.FontDescription.from_string('Italic 10'))
  layout.set_text(LOW_END_LABEL, -1)
  const [tw, th] = layout.get_pixel_size()
  cr.setSourceRGBA(0.75, 0.78, 0.76, 0.45)
  cr.moveTo((dw - tw) / 2, (dh - th) / 2)
  PangoCairo.show_layout(cr, layout)
}

interface LyricLine {
  start: number
  end:   number
  text:  string
}

interface LyricFile {
  path:    string
  names:   string[]
  authors: string[]
  lines:   LyricLine[]
  isInstrumental: boolean
}

interface CacheEntry {
  lyricFile:    LyricFile | null
  playCount:    number
  lastPlayedAt: number
}

const NO_TRACK = '/org/mpris/MediaPlayer2/TrackList/NoTrack'
const DECAY_λ  = 0.001

function normalizeSongStr(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*[\(\[](remaster(?:ed)?|live|feat\.?|ft\.?|explicit|radio\s*edit)[^\)\]]*[\)\]]/gi, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isTrackLevelId(tid: string): boolean {
  const base = tid.replace(/^\/org\/mpris\/MediaPlayer2\//, '')
  return base.includes('/')
}

export function buildSongId(player: AstalMpris.Player): string {
  const tid = player.trackid
  if (tid && tid !== NO_TRACK && isTrackLevelId(tid)) return `tid:${tid}`
  const t = normalizeSongStr(player.title  ?? '')
  const a = normalizeSongStr(player.artist ?? '')
  return `norm:${a}|${t}`
}

function parseTimeMicros(raw: string): number {
  const match = raw.trim().match(/^(\d+):(\d{2})(?:\.(\d+))?$/)
  if (!match) return 0
  const mins = parseInt(match[1], 10)
  const secs = parseInt(match[2], 10)
  const frac = parseInt((match[3] ?? '').padEnd(6, '0').slice(0, 6), 10)
  return (mins * 60 + secs) * 1_000_000 + frac
}

function fmtMicros(us: number): string {
  const totalSecs = Math.floor(us / 1_000_000)
  const m    = Math.floor(totalSecs / 60)
  const s    = totalSecs % 60
  const frac = us % 1_000_000
  const base = `${m}:${String(s).padStart(2, '0')}`
  if (frac === 0) return base
  return `${base}.${String(frac).padStart(6, '0').replace(/0+$/, '')}`
}

const decoder = new TextDecoder()

const RE_NAME     = /^name:\s*"(.+)"$/i
const RE_AUTHOR   = /^author:\s*"(.+)"$/i
const RE_LRC_LINE = /^\[(\d{1,2}:\d{2}(?:\.\d+)?)\]\s?(.*)$/

const RE_INSTRUMENTAL = /^"?is[_-]?instrumental"?\s*:\s*(true|false)\s*,?$/i

function splitAliases(raw: string): string[] {
  return raw.split(/\|\|\|/).map(s => s.trim()).filter(Boolean)
}

function parseLyrFile(path: string, content: string): LyricFile {
  const result: LyricFile = { path, names: [], authors: [], lines: [], isInstrumental: false }
  const parsedLines: { startUs: number; text: string }[] = []

  for (const raw of content.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let m: RegExpMatchArray | null
    if ((m = line.match(RE_INSTRUMENTAL))) { result.isInstrumental = m[1].toLowerCase() === 'true'; continue }
    if ((m = line.match(RE_NAME)))   { result.names   = splitAliases(m[1]); continue }
    if ((m = line.match(RE_AUTHOR))) { result.authors = splitAliases(m[1]); continue }
    if ((m = line.match(RE_LRC_LINE))) {
      parsedLines.push({ startUs: parseTimeMicros(m[1]), text: m[2] })
      continue
    }
  }

  parsedLines.sort((a, b) => a.startUs - b.startUs)
  const LAST_LINE_TAIL_US = 8_000_000
  result.lines = parsedLines.map((ln, i) => ({
    start: ln.startUs,
    end:   i < parsedLines.length - 1 ? parsedLines[i + 1].startUs : ln.startUs + LAST_LINE_TAIL_US,
    text:  ln.text,
  }))

  return result
}

const LYRICS_DIR = `${GLib.get_home_dir()}/lyrics`

const INSTRUMENTAL_DIR = `${LYRICS_DIR}/instrumental`
let lyricsIndex: Map<string, LyricFile[]> = new Map()
let indexReady  = false

const normKey = (s: string) => s.toLowerCase().trim()

const _indexRebuildSubs: Set<() => void> = new Set()
function subscribeIndexRebuild(cb: () => void): () => void {
  _indexRebuildSubs.add(cb)
  return () => _indexRebuildSubs.delete(cb)
}

function indexDir(dir: string) {
  if (!GLib.file_test(dir, GLib.FileTest.IS_DIR)) return
  try {
    const d = GLib.Dir.open(dir, 0)
    let fn = d.read_name()
    while (fn) {
      if (fn.endsWith('.lyr')) {
        const fp = `${dir}/${fn}`
        try {
          const [ok, raw] = GLib.file_get_contents(fp)
          if (ok) {
            const parsed = parseLyrFile(fp, decoder.decode(raw))
            const keys = new Set(
              [fn.replace(/\.lyr$/i, ''), ...parsed.names].map(normKey).filter(Boolean),
            )
            for (const k of keys) {
              if (!lyricsIndex.has(k)) lyricsIndex.set(k, [])
              lyricsIndex.get(k)!.push(parsed)
            }
          }
        } catch (e) { dwarn(`[lyrics] Error reading ${fp}:`, e) }
      }
      fn = d.read_name()
    }
    d.close()
  } catch (e) { dwarn('[lyrics] Dir open error:', e) }
}

function buildIndex() {
  lyricsIndex = new Map()
  indexReady  = false
  indexDir(LYRICS_DIR)
  indexDir(INSTRUMENTAL_DIR)
  indexReady = true
  if (FN_DEBUG) console.log(`[lyrics] Index: ${lyricsIndex.size} aliases, dir: ${LYRICS_DIR}`)
  _indexRebuildSubs.forEach(cb => { try { cb() } catch (_) {} })
}

const lyricsMonitors: Gio.FileMonitor[] = []
function watchLyricsDirs() {
  let debounce: number | null = null
  const schedule = () => {
    if (debounce != null) GLib.source_remove(debounce)
    debounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
      debounce = null
      buildIndex()
      return GLib.SOURCE_REMOVE
    })
  }
  for (const dir of [LYRICS_DIR, INSTRUMENTAL_DIR]) {
    try {
      GLib.mkdir_with_parents(dir, 0o755)
      const monitor = Gio.File.new_for_path(dir)
        .monitor_directory(Gio.FileMonitorFlags.NONE, null)
      monitor.connect('changed', schedule)
      lyricsMonitors.push(monitor)
    } catch (e) { dwarn(`[lyrics] Cannot watch ${dir}:`, e) }
  }
}

buildIndex()
watchLyricsDirs()

function lookupOnDisk(title: string, artist: string): LyricFile | null {
  if (!indexReady || !title) return null
  const tn = normKey(title)
  const an = normKey(artist)

  const scoreOf = (lf: LyricFile): number => {
    const allAuthors = lf.authors.map(normKey)
    if (allAuthors.length > 0) {
      if (!allAuthors.some(a => an.includes(a) || a.includes(an))) return -1
    }
    const names   = lf.names.map(normKey)
    const primary = names[0]
    if (primary === tn) return 3
    if (primary && (primary.includes(tn) || tn.includes(primary))) return 2
    if (names.slice(1).some(o => o === tn)) return 2
    if (names.slice(1).some(o => o.includes(tn) || tn.includes(o))) return 1
    return 0
  }

  const seen  = new Set<LyricFile>()
  const cands: LyricFile[] = []
  for (const [k, files] of lyricsIndex) {
    if (tn.includes(k) || k.includes(tn)) {
      for (const f of files) if (!seen.has(f)) { seen.add(f); cands.push(f) }
    }
  }
  if (!cands.length) return null
  return cands.map(f => ({ f, s: scoreOf(f) })).filter(x => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.f ?? null
}

const MAX_CACHE  = 200
const lyricCache = new Map<string, CacheEntry>()

const inFlightLookup = new Map<string, Promise<LyricFile | null>>()

function cacheScore(e: CacheEntry): number {
  const t = (Date.now() - e.lastPlayedAt) / 1000
  return e.playCount * Math.exp(-DECAY_λ * t)
}

function lrclibToLyrContent(t: { trackName: string; artistName: string; syncedLyrics: string | null }): string {
  const lines = (t.syncedLyrics ?? '')
    .split('\n')
    .filter(l => /^\[\d{1,2}:\d{2}/.test(l))
    .join('\n')
  return `name:"${t.trackName}"\n\nauthor:"${t.artistName}"\n\n${lines}\n`
}

function safeFilename(title: string, artist: string): string {
  const base = `${title} - ${artist}`.trim() || 'Unknown'
  return base.replace(/[\/\\:*?"<>|]/g, '').slice(0, 120)
}

function canonicalLyrPath(title: string, artist: string): string {
  return `${LYRICS_DIR}/${safeFilename(title, artist)}.lyr`
}

function writeNewLyrFile(title: string, artist: string, content: string): string {
  GLib.mkdir_with_parents(LYRICS_DIR, 0o755)

  const path = canonicalLyrPath(title, artist)
  GLib.file_set_contents(path, content)
  return path
}

function parseCanonicalLyr(title: string, artist: string): LyricFile | null {
  const path = canonicalLyrPath(title, artist)
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null
  try {
    const [ok, raw] = GLib.file_get_contents(path)
    if (ok) {
      const lf = parseLyrFile(path, decoder.decode(raw))
      if (lf.lines.length) return lf
    }
  } catch (_) {}
  return null
}

function instrumentalLyrContent(title: string, artist: string): string {
  return `name:"${title}"\n\nauthor:"${artist}"\n\nisinstrumental: true\n`
}

function canonicalInstrumentalPath(title: string, artist: string): string {
  return `${INSTRUMENTAL_DIR}/${safeFilename(title, artist)}.lyr`
}

function writeInstrumentalLyrFile(title: string, artist: string): string {
  GLib.mkdir_with_parents(INSTRUMENTAL_DIR, 0o755)
  const path = canonicalInstrumentalPath(title, artist)
  GLib.file_set_contents(path, instrumentalLyrContent(title, artist))
  return path
}

function parseCanonicalInstrumental(title: string, artist: string): LyricFile | null {
  const path = canonicalInstrumentalPath(title, artist)
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null
  try {
    const [ok, raw] = GLib.file_get_contents(path)
    if (ok) {
      const lf = parseLyrFile(path, decoder.decode(raw))
      if (lf.isInstrumental) return lf
    }
  } catch (_) {}
  return null
}

function cacheLookupWithApiFallback(
  songId: string, title: string, artist: string, album: string, durationSec: number,
): Promise<LyricFile | null> {
  const hit = lyricCache.get(songId)
  if (hit) {
    hit.playCount++
    hit.lastPlayedAt = Date.now()
    return Promise.resolve(hit.lyricFile)
  }

  const running = inFlightLookup.get(songId)
  if (running) return running

  const onDisk   = lookupOnDisk(title, artist)
    ?? parseCanonicalLyr(title, artist)
    ?? parseCanonicalInstrumental(title, artist)
  const apiFirst = loadSettings().lyricsPriority === 'api'

  const finalize = (found: LyricFile | null) => {
    if (lyricCache.size >= MAX_CACHE) {
      let worstKey = '', worstScore = Infinity
      for (const [k, v] of lyricCache) {
        const s = cacheScore(v)
        if (s < worstScore) { worstScore = s; worstKey = k }
      }
      if (worstKey) lyricCache.delete(worstKey)
    }
    lyricCache.set(songId, { lyricFile: found, playCount: 1, lastPlayedAt: Date.now() })
    return found
  }

  if (onDisk && !apiFirst) return Promise.resolve(finalize(onDisk))

  const p = fetchLrclib(artist, title, album, durationSec).then(track => {
    if (track && track.instrumental) {

      writeInstrumentalLyrFile(title, artist)
      buildIndex()
      const inst = parseCanonicalInstrumental(title, artist)
      if (inst) return finalize(inst)
    } else if (track && track.syncedLyrics) {
      writeNewLyrFile(title, artist, lrclibToLyrContent(track))
      buildIndex()
      const reparsed = lookupOnDisk(title, artist) ?? parseCanonicalLyr(title, artist)
      if (reparsed) return finalize(reparsed)
    }
    return finalize(onDisk ?? null)
  }).then(
    (r) => { inFlightLookup.delete(songId); return r },
    (e) => { inFlightLookup.delete(songId); throw e },
  )

  inFlightLookup.set(songId, p)
  return p
}

function findActiveLine(lines: LyricLine[], posMicros: number): number {
  let low = 0
  let high = lines.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const line = lines[mid]
    if (posMicros < line.start) high = mid - 1
    else if (posMicros >= line.end) low = mid + 1
    else return mid
  }
  return -1
}

const FIREFOX_MPRIS_ART_DIR = GLib.build_filenamev([
  CONFIG_HOME, 'mozilla', 'firefox', 'firefox-mpris',
])
let firefoxArtPath = ''
let firefoxArtCheckedAt = 0
const FIREFOX_ART_SCAN_INTERVAL_MS = 1500

function firefoxArtFallback(busName?: string): string {
  if (!busName || !busName.toLowerCase().includes('firefox')) return ''
  const now = Date.now()
  if (now - firefoxArtCheckedAt < FIREFOX_ART_SCAN_INTERVAL_MS) return firefoxArtPath
  firefoxArtCheckedAt = now
  let enumerator: Gio.FileEnumerator | null = null
  try {
    const dir = Gio.File.new_for_path(FIREFOX_MPRIS_ART_DIR)
    enumerator = dir.enumerate_children(
      'standard::name,standard::type,time::modified',
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    )
    let newestPath = ''
    let newestTime = 0
    let info
    while ((info = enumerator.next_file(null))) {
      if (info.get_file_type() !== Gio.FileType.REGULAR) continue
      const mtime = info.get_modification_date_time()?.to_unix() ?? 0
      if (mtime >= newestTime) {
        newestTime = mtime
        newestPath = GLib.build_filenamev([FIREFOX_MPRIS_ART_DIR, info.get_name()])
      }
    }
    firefoxArtPath = newestPath
    return firefoxArtPath
  } catch (_) {
    firefoxArtPath = ''
    return firefoxArtPath
  } finally {
    try { enumerator?.close(null) } catch (_) {}
  }
}

export function resolveCoverPath(player: AstalMpris.Player): string {
  const cover: string = (player as any).coverArt ?? ''
  if (cover) return cover
  const artUrl: string = (player as any).artUrl ?? ''
  if (artUrl.startsWith('file://')) return decodeURIComponent(artUrl.slice(7))
  return firefoxArtFallback((player as any).busName ?? '')
}

const FALLBACK_ART_SVG = `${AGS_CONFIG_DIR}/assets/music-note.svg`

function setVinylFallback(img: Gtk.Image, px: number): void {
  try {
    const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(FALLBACK_ART_SVG, px, px, true)
    img.set_from_pixbuf(pb)
  } catch (_) {
    img.set_from_icon_name('audio-x-generic-symbolic', Gtk.IconSize.DND)
  }
}

function AlbumArt({ player }: { player: AstalMpris.Player }) {
  return (
    <box class="album-art-box"
      $={(self: any) => {
        const img = new Gtk.Image()
        img.set_pixel_size(36)
        setVinylFallback(img, 36)
        self.add(img); img.show()
        const ART_SIZE = 36
        let loaded = false
        let alive  = true
        let lastColorPath = ''
        const setArt = () => {
          const path = resolveCoverPath(player)
          try {
            if (path) {
              const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, ART_SIZE, ART_SIZE, true)
              img.set_from_pixbuf(pb)
              loaded = true

              if (path !== lastColorPath) { lastColorPath = path; applyArtSpectrum(path) }
            } else if (!loaded) {
              setVinylFallback(img, ART_SIZE)
              if (lastColorPath !== '') { lastColorPath = ''; applyArtSpectrum('') }
            }
          } catch (_) {
            if (!loaded) setVinylFallback(img, ART_SIZE)
          }
        }
        setArt()
        const u1 = createBinding(player, 'coverArt').subscribe(setArt)
        const u2 = createBinding(player, 'artUrl').subscribe(setArt)

        const retryIds = new Set<number>()
        for (const ms of [250, 800, 2000]) {
          let id = 0
          id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            retryIds.delete(id)
            if (alive && !loaded) setArt()
            return GLib.SOURCE_REMOVE
          })
          retryIds.add(id)
        }
        self.connect('destroy', () => {
          alive = false
          u1(); u2()
          retryIds.forEach(id => { try { GLib.source_remove(id) } catch (_) {} })
          retryIds.clear()
        })
      }}
    />
  )
}

function MediaInfo({ player }: { player: AstalMpris.Player }) {
  const title  = createBinding(player, 'title').as((t: string)  => t || 'No music')
  const artist = createBinding(player, 'artist').as((a: string) => a || 'Unknown artist')

  const fix = (self: any, chars: number) => {
    self.set_ellipsize(Pango.EllipsizeMode.END)
    self.set_max_width_chars(chars)
    self.set_width_chars(chars)
  }

  const titleLabel = (
    <label class="song-title" label={title} xalign={0} $={(s: any) => fix(s, 22)} />
  ) as Gtk.Label
  const artistLabel = (
    <label class="song-artist" label={artist} xalign={0} $={(s: any) => fix(s, 22)} />
  ) as Gtk.Label

  const infoBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
    valign: Gtk.Align.CENTER,
  })
  infoBox.get_style_context().add_class('media-info')
  infoBox.add(fixedLineSlot(titleLabel, 18, 14, 170))
  infoBox.add(fixedLineSlot(artistLabel, 15, 12, 170))
  return infoBox
}

function MediaControls({ player }: { player: AstalMpris.Player }) {
  if (FN_DEBUG) console.log(`[MediaControls] rendering for player: bus=${player?.bus_name} valid=${!!player}`)
  const status    = createBinding(player, 'playbackStatus')
  const playClass = status.as((s: AstalMpris.PlaybackStatus) =>
    s === AstalMpris.PlaybackStatus.PLAYING ? 'ctrl-btn play active' : 'ctrl-btn play')
  return (
    <box class="media-controls" spacing={6} valign={Gtk.Align.CENTER}>
      <button class="ctrl-btn"
        sensitive={createBinding(player, 'canGoPrevious')}
        onClicked={() => {
          if (FN_DEBUG) console.log(`[MediaControls] prev clicked: bus=${player?.bus_name} canGoPrevious=${player?.canGoPrevious}`)
          try { if (player.canGoPrevious) player.previous() } catch (e) { derr(`[MediaControls] prev error: ${e}`) }
        }}>
        {iconImage('prev', IC.secondary, 15)}
      </button>
      <button class={playClass} onClicked={() => {
        if (FN_DEBUG) console.log(`[MediaControls] play_pause clicked: bus=${player?.bus_name}`)
        try { player.play_pause() } catch (e) { derr(`[MediaControls] play_pause error: ${e}`) }
      }}>
        {IconImg(status.as((s: AstalMpris.PlaybackStatus) =>
          s === AstalMpris.PlaybackStatus.PLAYING ? 'pause' : 'play'), IC.accent, 16)}
      </button>
      <button class="ctrl-btn-next"
        sensitive={createBinding(player, 'canGoNext')}
        onClicked={() => {
          if (FN_DEBUG) console.log(`[MediaControls] next clicked: bus=${player?.bus_name} canGoNext=${player?.canGoNext}`)
          try { if (player.canGoNext) player.next() } catch (e) { derr(`[MediaControls] next error: ${e}`) }
        }}>
        {iconImage('next', IC.secondary, 15)}
      </button>
    </box>
  )
}

interface FlyoutHandle {
  close: () => void
  replaceContent: (content: Gtk.Widget) => void
}

function openFlyoutWin(
  gdkmonitor: Gdk.Monitor,
  content: Gtk.Widget,
  onClosed: () => void = () => {},
  marginTop = 40,
  namespace = "ags-music-flyout",
): FlyoutHandle {
  let closed = false
  let finalized = false
  let currentContent = content
  let resizeId: number | null = null

  const flyWin = new (Astal.Window as any)({
    gdkmonitor,
    exclusivity:   Astal.Exclusivity.IGNORE,
    layer:         Astal.Layer.OVERLAY,
    anchor:        Astal.WindowAnchor.TOP,
    margin_top:    marginTop,
    keymode:       Astal.Keymode.NONE,
    application:   app,
    namespace,
  }) as Astal.Window
  const unregisterFlyout = registerFlyout()
  flyWin.get_style_context().add_class('FlyoutWindow')
  ;(function() {
    const screen = flyWin.get_screen()
    const visual = screen?.get_rgba_visual()
    if (visual) flyWin.set_visual(visual)
  })()
  const host = new Gtk.Box({ visible: true })
  host.add(content)
  flyWin.add(host)
  flyWin.show_all()

  const queueResize = () => {
    if (resizeId !== null) GLib.source_remove(resizeId)
    resizeId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      resizeId = null
      if (closed) return GLib.SOURCE_REMOVE
      try {
        const [, natW] = (currentContent as any).get_preferred_width()
        const margins = (currentContent as any).get_margin_start() + (currentContent as any).get_margin_end()
        if (natW > 0) flyWin.set_size_request(natW + margins, -1)
      } catch (_) {}
      return GLib.SOURCE_REMOVE
    })
  }
  queueResize()

  const finalize = () => {
    if (finalized) return
    finalized = true
    closed = true
    if (resizeId !== null) { GLib.source_remove(resizeId); resizeId = null }
    unregisterFlyout()
    onClosed()
  }

  const close = () => {
    if (closed) return
    closed = true
    try { flyWin.destroy() } catch (_) {}
    finalize()
  }
  const replaceContent = (nextContent: Gtk.Widget) => {
    if (closed) {
      try { nextContent.destroy() } catch (_) {}
      return
    }
    if (nextContent === currentContent) return
    try { currentContent.destroy() } catch (_) {}
    currentContent = nextContent
    host.add(currentContent)
    currentContent.show_all()
    queueResize()
  }
  flyWin.connect('destroy', finalize)
  return { close, replaceContent }
}

const _npToggles = new Map<Gdk.Monitor, () => void>()
export function toggleNowPlaying() {
  let selected: (() => void) | null = null
  try {
    const pointer = Gdk.Display.get_default()?.get_default_seat()?.get_pointer()
    const [, x, y] = pointer?.get_position() ?? [null, -1, -1]
    for (const [monitor, toggle] of _npToggles) {
      const geo = monitor.get_geometry()
      if (x >= geo.x && x < geo.x + geo.width && y >= geo.y && y < geo.y + geo.height) {
        selected = toggle
        break
      }
    }
  } catch (_) {}
  ;(selected ?? _npToggles.values().next().value ?? null)?.()
}

function buildNowPlayingContent(player: AstalMpris.Player, gdkmonitor: Gdk.Monitor): Gtk.Box {
  const monitorWidth = gdkmonitor.get_geometry().width
  const flyoutWidth = Math.min(900, Math.max(300, monitorWidth - 24))
  const compact = flyoutWidth < 760
  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true,
  })
  root.set_size_request(flyoutWidth, -1)
  root.get_style_context().add_class('npp-root')
  const topArea = new Gtk.Box({ visible: true, hexpand: true, vexpand: true })
  topArea.get_style_context().add_class('npp-top-area')
  root.add(topArea)

  const row = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL, spacing: 0,
    visible: true, vexpand: true,
  })
  topArea.add(row)
  if (!LOW_END) attachChromaBackground(topArea, player)

  const leftSection = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
    vexpand: true,
    valign: Gtk.Align.FILL,
  })
  leftSection.get_style_context().add_class('npp-side-panel-left')

  const leftPanel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL, spacing: 4, visible: true,
    margin_start: 16, margin_end: 6,
    margin_top: 33, margin_bottom: 20,
  })
  buildLeftPanel(leftPanel)
  leftSection.add(leftPanel)
  row.add(leftSection)
  const vsep1Wrap = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
    margin_top: 25,
    margin_bottom: 12,
  })
  const vsep1 = new Gtk.Separator({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
    vexpand: true,
  })
  vsep1.get_style_context().add_class('npp-vsep')
  vsep1Wrap.add(vsep1)
  row.add(vsep1Wrap)

  const center = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL, spacing: 6,
    visible: true, hexpand: true, vexpand: true,
    margin_start: 0, margin_end: 0,
    margin_top: 25, margin_bottom: 12,
  })
  row.add(center)

  const artImg = new Gtk.Image({ visible: true })
  artImg.get_style_context().add_class('npp-art')
  artImg.set_halign(Gtk.Align.CENTER)
  const ART_SIZE = 220
  let artFallbackId: number | null = null
  let displayedCover = ''
  let artworkReady = false
  let artAlive = true
  artImg.set_size_request(ART_SIZE, ART_SIZE)

  const clearArtFallback = () => {
    if (artFallbackId === null) return
    GLib.source_remove(artFallbackId)
    artFallbackId = null
  }
  const showArtFallback = () => {
    clearArtFallback()
    setVinylFallback(artImg, 72)
    artImg.set_pixel_size(72)
    displayedCover = ''
    artworkReady = true
  }
  const loadArtwork = (path: string): boolean => {
    if (!path || !GLib.file_test(path, GLib.FileTest.IS_REGULAR)) return false
    try {
      const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, ART_SIZE, ART_SIZE, true)
      artImg.set_from_pixbuf(pb)
      clearArtFallback()
      displayedCover = path
      artworkReady = true
      return true
    } catch (_) {
      return false
    }
  }
  const updateArt = (path = resolveCoverPath(player)) => {
    if (path === displayedCover && artworkReady) {
      clearArtFallback()
      return
    }
    if (loadArtwork(path)) return
    if (!artworkReady || displayedCover === '') {
      showArtFallback()
      return
    }
    if (artFallbackId !== null) return
    artFallbackId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
      artFallbackId = null
      if (!artAlive) return GLib.SOURCE_REMOVE
      const currentPath = resolveCoverPath(player)
      if (!loadArtwork(currentPath)) showArtFallback()
      return GLib.SOURCE_REMOVE
    })
  }
  updateArt()
  artImg.set_margin_top(15)
  artImg.set_margin_bottom(4)
  center.add(artImg)

  const trackDetails = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
    visible: true,
    hexpand: true,
  })
  trackDetails.get_style_context().add_class('npp-track-details')
  center.add(trackDetails)

  const infoBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL, spacing: 4,
    visible: true, halign: Gtk.Align.FILL, valign: Gtk.Align.FILL,
  })

  const INFO_HEIGHT = 45
  const infoPanel = new Gtk.Box({ visible: true, hexpand: true })
  infoPanel.get_style_context().add_class('npp-track-info')
  const infoWrap = new Gtk.Overlay({ visible: true, hexpand: true })
  const infoSpacer = new Gtk.Box({ visible: true })
  infoSpacer.set_size_request(-1, INFO_HEIGHT)
  infoWrap.add(infoSpacer)
  infoWrap.add_overlay(infoBox)
  infoWrap.set_overlay_pass_through(infoBox, true)
  infoPanel.add(infoWrap)
  trackDetails.add(infoPanel)

  const titleLbl = new Gtk.Label({ visible: true, xalign: 0.5 })
  titleLbl.get_style_context().add_class('npp-title')
  titleLbl.set_ellipsize(3)
  titleLbl.set_max_width_chars(32)
  titleLbl.set_width_chars(32)
  infoBox.add(fixedLineSlot(titleLbl, 23, 18))

  const artistLbl = new Gtk.Label({ visible: true, xalign: 0.5 })
  artistLbl.get_style_context().add_class('npp-artist')
  artistLbl.set_ellipsize(3)
  artistLbl.set_max_width_chars(32)
  artistLbl.set_width_chars(32)
  infoBox.add(fixedLineSlot(artistLbl, 18, 14))

  const progRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: compact ? 4 : 10,
    visible: true,
    hexpand: true,
  })
  progRow.get_style_context().add_class('npp-progress-row')
  if (compact) progRow.get_style_context().add_class('compact')
  trackDetails.add(progRow)

  const posLbl = new Gtk.Label({ label: '0:00', visible: true })
  posLbl.get_style_context().add_class('npp-time')
  progRow.add(posLbl)

  const posSeparator = new Gtk.Separator({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
  })
  posSeparator.get_style_context().add_class('npp-progress-separator')
  progRow.add(posSeparator)

  const adj = new Gtk.Adjustment({ lower: 0, upper: 1, value: 0, step_increment: 0.01, page_increment: 0.1 })
  const progScale = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment: adj, draw_value: false, visible: true,
  })
  progScale.get_style_context().add_class('npp-scale')
  progScale.set_hexpand(true)
  progRow.add(progScale)

  const durSeparator = new Gtk.Separator({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
  })
  durSeparator.get_style_context().add_class('npp-progress-separator')
  progRow.add(durSeparator)

  const durLbl = new Gtk.Label({ label: '0:00', visible: true })
  durLbl.get_style_context().add_class('npp-time')
  progRow.add(durLbl)

  const ctrlsWrap = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, visible: true, halign: Gtk.Align.CENTER })
  ctrlsWrap.get_style_context().add_class('npp-controls-wrap')

  const prevCtrl = new Gtk.Button({ visible: true })
  prevCtrl.get_style_context().add_class('npp-ctrl-btn')
  prevCtrl.add(iconImage('prev', IC.secondary, 16))
  try { prevCtrl.set_sensitive(!!player.canGoPrevious) } catch (_) {}
  prevCtrl.connect('clicked', () => { try { if (player.canGoPrevious) player.previous() } catch (_) {} })

  const playCtrlImg = new Gtk.Image({ visible: true })
  setBarIcon(playCtrlImg, player.playbackStatus === AstalMpris.PlaybackStatus.PLAYING ? 'pause' : 'play', IC.accent, 17)
  const playCtrl = new Gtk.Button({ visible: true })
  playCtrl.get_style_context().add_class('npp-ctrl-btn')
  playCtrl.get_style_context().add_class('npp-ctrl-play')
  playCtrl.add(playCtrlImg)
  playCtrl.connect('clicked', () => { try { player.play_pause() } catch (_) {} })

  const nextCtrl = new Gtk.Button({ visible: true })
  nextCtrl.get_style_context().add_class('npp-ctrl-btn')
  nextCtrl.add(iconImage('next', IC.secondary, 16))
  try { nextCtrl.set_sensitive(!!player.canGoNext) } catch (_) {}
  nextCtrl.connect('clicked', () => { try { if (player.canGoNext) player.next() } catch (_) {} })

  ctrlsWrap.add(prevCtrl)
  ctrlsWrap.add(playCtrl)
  ctrlsWrap.add(nextCtrl)
  center.add(ctrlsWrap)

  const vsep2Wrap = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
    margin_top: 25,
    margin_bottom: 12,
  })
  const vsep2 = new Gtk.Separator({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
    vexpand: true,
  })
  vsep2.get_style_context().add_class('npp-vsep')
  vsep2Wrap.add(vsep2)
  row.add(vsep2Wrap)

  const rightSection = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    visible: true,
    vexpand: true,
    valign: Gtk.Align.FILL,
  })
  rightSection.get_style_context().add_class('npp-side-panel-right')

  const rightPanel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL, spacing: 4, visible: true,
    margin_start: 6, margin_end: 16,
    margin_top: 33, margin_bottom: 20,
  })
  buildRightPanel(rightPanel)
  rightSection.add(rightPanel)
  row.add(rightSection)

  if (compact) {
    leftSection.set_no_show_all(true)
    rightSection.set_no_show_all(true)
    vsep1Wrap.set_no_show_all(true)
    vsep2Wrap.set_no_show_all(true)
    leftSection.hide(); rightSection.hide(); vsep1Wrap.hide(); vsep2Wrap.hide()
  }

  const specSep = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true })
  specSep.get_style_context().add_class('npp-spec-sep')
  root.add(specSep)

  const FLYOUT_BARS = 64
  const specDA = new Gtk.DrawingArea({ visible: true })
  specDA.get_style_context().add_class('npp-spectrum')
  specDA.set_size_request(-1, 52)
  specDA.set_hexpand(true)
  specDA.set_margin_top(6)
  specDA.set_margin_bottom(8)
  specDA.set_margin_start(12)
  specDA.set_margin_end(12)
  root.add(specDA)

  specDA.connect('draw', (_w: any, cr: any) => {
    const dw = specDA.get_allocated_width(), dh = specDA.get_allocated_height()
    if (LOW_END) drawLowEndText(cr, dw, dh)
    else         drawLevelSpectrum(cr, dw, dh, FLYOUT_BARS)
    return false
  })

  root.show_all()

  const fmtSec = (s: number): string => {
    const m  = Math.floor(Math.max(0, s) / 60)
    const ss = Math.floor(Math.max(0, s) % 60)
    return `${m}:${String(ss).padStart(2, '0')}`
  }

  let lastTitle  = ''
  let lastArtist = ''
  let alive      = true
  let isSeeking  = false
  let curLen     = 0

  progScale.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK)
  progScale.connect('button-press-event', () => { isSeeking = true; return false })
  progScale.connect('button-release-event', () => {
    isSeeking = false
    const target = adj.get_value() * curLen
    if (curLen > 0) {
      try { player.set_position(target) } catch (_) {}
    }
    return false
  })

  const updateInfo = (): boolean => {
    try {
      const nextTitle  = player.title  ?? ''
      const nextArtist = player.artist ?? ''
      if (nextTitle !== lastTitle) { lastTitle = nextTitle; titleLbl.set_label(nextTitle) }
      if (nextArtist !== lastArtist) { lastArtist = nextArtist; artistLbl.set_label(nextArtist) }
      const curCover = resolveCoverPath(player)
      if (curCover !== displayedCover || artFallbackId !== null) updateArt(curCover)
      const pos = player.position
      const len = player.length
      curLen = len
      posLbl.set_label(fmtSec(pos))
      durLbl.set_label(fmtSec(len))
      if (!isSeeking) adj.set_value(len > 0 ? Math.min(1, Math.max(0, pos / len)) : 0)
      setBarIcon(playCtrlImg, player.playbackStatus === AstalMpris.PlaybackStatus.PLAYING ? 'pause' : 'play', IC.accent, 17)
    } catch (_) { return false }
    return true
  }

  updateInfo()

  let pollId: any = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
    if (!alive || !updateInfo()) { alive = false; return GLib.SOURCE_REMOVE }
    return GLib.SOURCE_CONTINUE
  })

  let specTickId: any = null
  if (!LOW_END) {
    specTickId = specDA.add_tick_callback(() => {
      if (!alive) return GLib.SOURCE_REMOVE
      specDA.queue_draw()
      return GLib.SOURCE_CONTINUE
    })
  }

  root.connect('destroy', () => {
    alive = false
    artAlive = false
    clearArtFallback()
    if (pollId     != null) { GLib.source_remove(pollId);     pollId     = null }
    if (specTickId != null) { specDA.remove_tick_callback(specTickId); specTickId = null }
  })

  return root
}

function LyricsViewer({ player, gdkmonitor }: { player: AstalMpris.Player, gdkmonitor: Gdk.Monitor }) {
  let lyricsFile: LyricFile | null = null
  let activeIdx = -1

  let posAnchorUs = -1
  let wallAnchor  = 0
  let lastRawUs   = -1
  let lastPosUs   = -1

  const [lyricText,   setLyricText]   = createState('No lyrics loaded')
  const [lyricsFound, setLyricsFound] = createState(false)

  let reloadGen = 0
  const reload = () => {
    const myGen = ++reloadGen
    lyricsFile = null
    activeIdx  = -1
    setLyricsFound(false)
    setLyricText('No lyrics loaded')

    const title    = player.title  ?? ''
    const artist   = player.artist ?? ''
    const album    = player.album  ?? ''
    const duration = player.length ?? 0
    if (!title) return

    const songId = buildSongId(player)
    cacheLookupWithApiFallback(songId, title, artist, album, duration).then(found => {
      if (myGen !== reloadGen) return
      if (found) {
        lyricsFile = found
        setLyricsFound(true)

        setLyricText(found.isInstrumental ? 'Instrumental' : ' ')
        if (FN_DEBUG) console.log(`[lyrics] Loaded (${songId}): ${found.path}`)
      }
    })
  }

  const unsubTitle  = createBinding(player, 'title').subscribe(reload)
  const unsubArtist = createBinding(player, 'artist').subscribe(reload)
  const unsubIndex  = subscribeIndexRebuild(reload)

  reload()

  let retryId1: number | null = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
    retryId1 = null
    reload()
    return GLib.SOURCE_REMOVE
  })
  let retryId2: number | null = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2200, () => {
    retryId2 = null
    reload()
    return GLib.SOURCE_REMOVE
  })

  const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LYRIC_SYNC_MS, () => {
    if (lyricsFile && !lyricsFile.isInstrumental && player.playbackStatus === AstalMpris.PlaybackStatus.PLAYING) {
      const rawUs   = Math.round((player.position ?? 0) * 1_000_000)
      const nowWall = GLib.get_monotonic_time()

      if (rawUs !== lastRawUs) {
        lastRawUs   = rawUs
        posAnchorUs = rawUs
        wallAnchor  = nowWall
      }
      const posMicros = posAnchorUs >= 0 ? posAnchorUs + (nowWall - wallAnchor) : rawUs
      lastPosUs = posMicros
      const idx = findActiveLine(lyricsFile.lines, posMicros)
      if (idx !== activeIdx) {
        activeIdx = idx
        setLyricText(idx >= 0 ? lyricsFile.lines[idx].text : ' ')
      }
    } else {

      posAnchorUs = -1
      lastRawUs   = -1
    }
    return GLib.SOURCE_CONTINUE
  })

  onCleanup(() => {
    unsubTitle()
    unsubArtist()
    unsubIndex()
    try { GLib.source_remove(pollId) } catch (_) {}
    if (retryId1 != null) { GLib.source_remove(retryId1); retryId1 = null }
    if (retryId2 != null) { GLib.source_remove(retryId2); retryId2 = null }
  })

  const buildLyricsContent = (): Gtk.Box => {
    const vbox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 6,
      margin_top: 25, margin_bottom: 14,
      margin_start: 20, margin_end: 20,
    })
    vbox.get_style_context().add_class('lyrics-flyout-root')
    vbox.set_size_request(
      Math.min(400, Math.max(280, gdkmonitor.get_geometry().width - 24)),
      -1,
    )

    const filenameLbl = new Gtk.Label({
      label:   lyricsFile ? lyricsFile.path.split('/').pop()! : 'No lyrics loaded',
      visible: true,
      xalign:  0.5,
    })
    filenameLbl.get_style_context().add_class('pop-lyric-filename')
    vbox.add(filenameLbl)

    vbox.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

    const makeRow = (cls: string) => {
      const lbl = new Gtk.Label({ label: '', visible: true, xalign: 0.5 })
      lbl.get_style_context().add_class(cls)
      lbl.set_line_wrap(true)
      vbox.add(lbl)
      return lbl
    }
    const prevLbl = makeRow('pop-lyric-context')
    const currLbl = makeRow('pop-lyric-current')
    const nextLbl = makeRow('pop-lyric-context')

    const fmtRow = (ln: LyricLine | null): string => {
      if (!ln) return ''
      return ln.text ? `${fmtMicros(ln.start)}  |  ${ln.text}` : `${fmtMicros(ln.start)}  |   `
    }

    let lastIdx = -2
    const refreshRows = () => {

      if (lyricsFile?.isInstrumental) {
        if (lastIdx === -3) return
        lastIdx = -3
        prevLbl.set_label('')
        currLbl.set_label('Instrumental')
        nextLbl.set_label('')
        return
      }
      const cur   = activeIdx
      if (cur === lastIdx) return
      lastIdx = cur

      const lines = lyricsFile?.lines ?? []
      let prev: LyricLine | null = null
      let curr: LyricLine | null = null
      let next: LyricLine | null = null
      if (cur >= 0) {
        prev = cur > 0                ? lines[cur - 1] : null
        curr = lines[cur]
        next = cur < lines.length - 1 ? lines[cur + 1] : null
      } else if (lines.length) {

        if (lastPosUs >= lines[lines.length - 1].end) {
          prev = lines[lines.length - 1]
        } else {
          next = lines[0]
        }
      }

      prevLbl.set_label(fmtRow(prev))
      currLbl.set_label(curr ? fmtRow(curr) : (lyricsFile ? ' ' : ''))
      nextLbl.set_label(fmtRow(next))
    }

    refreshRows()
    vbox.show_all()

    let flyAlive  = true
    let flyPollId: any = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
      if (!flyAlive) return GLib.SOURCE_REMOVE
      try { refreshRows() } catch (_) { flyAlive = false; return GLib.SOURCE_REMOVE }
      return GLib.SOURCE_CONTINUE
    })
    vbox.connect('destroy', () => {
      flyAlive = false
      if (flyPollId != null) { GLib.source_remove(flyPollId); flyPollId = null }
    })

    return vbox
  }

  return (
    <button class="lyrics-container" valign={Gtk.Align.CENTER}
      $={(self: any) => {
        self.set_relief(Gtk.ReliefStyle.NONE)
        self.set_can_focus(false)

        let flyout: FlyoutHandle | null = null
        let leaveTimer: any = null

        const cancelLeave = () => {
          if (leaveTimer) { GLib.source_remove(leaveTimer); leaveTimer = null }
        }

        self.connect('enter-notify-event', () => {
          cancelLeave()
          if (!flyout) {
            const content = buildLyricsContent()
            flyout = openFlyoutWin(gdkmonitor, content, () => { flyout = null })
          }
        })

        self.connect('leave-notify-event', () => {
          leaveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            leaveTimer = null
            if (flyout) { flyout.close(); flyout = null }
            return GLib.SOURCE_REMOVE
          })
        })

        self.connect('clicked', () => {
          cancelLeave()
          if (flyout) { flyout.close(); flyout = null }
          else {
            const content = buildLyricsContent()
            flyout = openFlyoutWin(gdkmonitor, content, () => { flyout = null })
          }
        })
        self.connect('destroy', () => {
          cancelLeave()
          if (flyout) { flyout.close(); flyout = null }
        })
      }}
    >
      <label
        class={lyricsFound.as((f: boolean) => f ? 'lyric-label active' : 'lyric-label no-lyrics')}
        label={lyricText}
        hexpand
        halign={Gtk.Align.CENTER}
        ellipsize={3}
      />
    </button>
  )
}

const ART_CACHE_DIR = cachePath('ags', 'art')
const MAX_ART_CACHE_FILES = 256
const MAX_ART_CACHE_BYTES = 64 * 1024 * 1024
const ART_CACHE_PRUNE_INTERVAL_MS = 5 * 60 * 1000
let lastArtCachePrune = 0

function pruneArtworkCache(preservePath = ''): void {
  const now = Date.now()
  if (now - lastArtCachePrune < ART_CACHE_PRUNE_INTERVAL_MS) return
  lastArtCachePrune = now
  let enumerator: Gio.FileEnumerator | null = null
  try {
    enumerator = Gio.File.new_for_path(ART_CACHE_DIR).enumerate_children(
      'standard::name,standard::type,standard::size,time::modified',
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    )
    const files: Array<{ path: string; size: number; modified: number }> = []
    let info
    while ((info = enumerator.next_file(null))) {
      if (info.get_file_type() !== Gio.FileType.REGULAR) continue
      const path = GLib.build_filenamev([ART_CACHE_DIR, info.get_name()])
      try { GLib.chmod(path, 0o600) } catch (_) {}
      files.push({
        path,
        size: Math.max(0, Number(info.get_size()) || 0),
        modified: Number(info.get_attribute_uint64('time::modified')) || 0,
      })
    }
    files.sort((left, right) => right.modified - left.modified)
    let retainedFiles = 0
    let retainedBytes = 0
    for (const file of files) {
      const withinLimits = retainedFiles < MAX_ART_CACHE_FILES
        && retainedBytes + file.size <= MAX_ART_CACHE_BYTES
      if (file.path === preservePath || withinLimits) {
        retainedFiles++
        retainedBytes += file.size
      } else {
        try { Gio.File.new_for_path(file.path).delete(null) } catch (_) {}
      }
    }
  } catch (e) {
    dwarn('[art-cache] prune failed:', e)
  } finally {
    try { enumerator?.close(null) } catch (_) {}
  }
}

export function cacheArtwork(sourcePath: string, title: string, artist: string): string {
  if (!sourcePath || !GLib.file_test(sourcePath, GLib.FileTest.EXISTS)) return sourcePath
  try {
    GLib.mkdir_with_parents(ART_CACHE_DIR, 0o700)
    GLib.chmod(ART_CACHE_DIR, 0o700)

    const key  = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, `${title}|${artist}`.toLowerCase(), -1)
    const suffix = GLib.path_get_basename(sourcePath).split('.').pop()?.toLowerCase() ?? ''
    const ext = ['png', 'jpg', 'jpeg', 'webp'].includes(suffix) ? suffix : 'png'
    const dest = `${ART_CACHE_DIR}/${key}.${ext}`
    if (!GLib.file_test(dest, GLib.FileTest.EXISTS)) {
      Gio.File.new_for_path(sourcePath).copy(
        Gio.File.new_for_path(dest),
        Gio.FileCopyFlags.OVERWRITE, null, null
      )
    }
    GLib.chmod(dest, 0o600)
    pruneArtworkCache(dest)
    return dest
  } catch (e) {
    dwarn('[art-cache] copy failed:', e)
    return sourcePath
  }
}

function fmtSecs(s: number): string {
  const h  = Math.floor(s / 3600)
  const m  = Math.floor((s % 3600) / 60)
  const ss = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${m}:${String(ss).padStart(2, '0')}`
}

function fmtUrl(url: string): string {
  if (!url) return ''
  try {
    const decoded = url.startsWith('file://') ? decodeURIComponent(url.slice(7)) : url
    const parts   = decoded.replace(/\\/g, '/').split('/')
    const name    = parts[parts.length - 1] || decoded
    return name.length > 28 ? name.slice(0, 25) + '…' : name
  } catch (_) { return url.slice(0, 28) }
}

const _panelArtCache = new Map<string, GdkPixbuf.Pixbuf>()
const MAX_PANEL_ART_CACHE = 256
function loadPanelArt(img: Gtk.Image, coverPath: string) {
  const SIZE = 16
  try {
    if (coverPath && GLib.file_test(coverPath, GLib.FileTest.EXISTS)) {
      let pb = _panelArtCache.get(coverPath)
      if (!pb) {
        pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(coverPath, SIZE, SIZE, true)
        if (_panelArtCache.size >= MAX_PANEL_ART_CACHE) {
          const oldest = _panelArtCache.keys().next().value
          if (oldest !== undefined) _panelArtCache.delete(oldest)
        }
        _panelArtCache.set(coverPath, pb)
      }
      img.set_from_pixbuf(pb)
      return
    }
  } catch (_) {}
  img.set_pixel_size(SIZE)
  setVinylFallback(img, SIZE)
}

function stripZalgo(s: string): string {
  try {
    return s.normalize('NFC')
      .replace(/\p{M}+/gu, '')
      .replace(/[ऀ-࿿က-႟ក-៿]/g, '')
      .replace(/[ \t]{2,}/g, ' ').trim()
  } catch (_) { return s }
}

function clipInk(w: Gtk.Widget): void {
  w.connect('draw', (widget: Gtk.Widget, cr: any) => {
    const a = widget.get_allocation()
    cr.rectangle(0, 0, a.width, a.height)
    cr.clip()
    return false
  })
}

function fixedLineSlot(
  label: Gtk.Label,
  height: number,
  baseline: number,
  width = -1,
): Gtk.Overlay {
  label.set_single_line_mode(true)
  label.set_halign(Gtk.Align.FILL)
  label.set_valign(Gtk.Align.BASELINE)
  clipInk(label)

  const slot = new Gtk.Overlay({ visible: true, hexpand: true })
  const spacer = new Gtk.DrawingArea({ visible: true })
  spacer.set_size_request(width, height)
  slot.add(spacer)
  slot.add_overlay(label)
  slot.set_overlay_pass_through(label, true)
  slot.connect('get-child-position', (overlay: Gtk.Overlay, child: Gtk.Widget, allocation: Gdk.Rectangle) => {
    const availableWidth = Math.max(1, overlay.get_allocated_width())
    const [, naturalHeight, , naturalBaseline] =
      child.get_preferred_height_and_baseline_for_width(availableWidth)
    allocation.x = 0
    allocation.y = naturalBaseline >= 0 ? baseline - naturalBaseline : 0
    allocation.width = availableWidth
    allocation.height = Math.max(1, naturalHeight)
    return true
  })
  return slot
}

function buildTopListenedRow(entry: ListenEntry | null): Gtk.Box {
  const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5, visible: true })
  row.get_style_context().add_class('panel-row')

  if (!entry) {
    row.get_style_context().add_class('panel-row-empty')
    row.set_halign(Gtk.Align.CENTER)
    const lbl = new Gtk.Label({ label: '- No Data -', visible: true })
    lbl.get_style_context().add_class('panel-no-data')
    row.add(lbl)
    return row
  }

  const artImg = new Gtk.Image({ visible: true })
  artImg.get_style_context().add_class('panel-art')
  artImg.set_valign(Gtk.Align.START)
  loadPanelArt(artImg, entry.coverPath)
  row.add(artImg)

  const col = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 1, visible: true })
  col.set_hexpand(true)
  row.add(col)

  const tLbl = new Gtk.Label({ label: stripZalgo(entry.title || '-'), visible: true, xalign: 0 })
  tLbl.get_style_context().add_class('panel-song-title')
  tLbl.set_ellipsize(3)
  tLbl.set_max_width_chars(18)
  col.add(fixedLineSlot(tLbl, 24, 18))

  const aLbl = new Gtk.Label({ label: stripZalgo(entry.artist || '-'), visible: true, xalign: 0 })
  aLbl.get_style_context().add_class('panel-song-artist')
  aLbl.set_ellipsize(3)
  aLbl.set_max_width_chars(18)
  col.add(fixedLineSlot(aLbl, 22, 16))

  const timeLbl = new Gtk.Label({
    label: `${fmtSecs(entry.totalSeconds)}  ·  ${entry.completePlays}✓  ${entry.partialPlays}½`,
    visible: true, xalign: 0,
  })
  timeLbl.get_style_context().add_class('panel-listen-time')
  col.add(fixedLineSlot(timeLbl, 17, 13))

  return row
}

function buildRecentRow(entry: RecentEntry | null): Gtk.Widget {
  if (!entry) {
    const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5, visible: true })
    row.get_style_context().add_class('panel-row')
    row.get_style_context().add_class('panel-row-empty')
    row.set_halign(Gtk.Align.CENTER)
    const lbl = new Gtk.Label({ label: '- No Data -', visible: true })
    lbl.get_style_context().add_class('panel-no-data')
    row.add(lbl)
    return row
  }

  const btn = new Gtk.Button({ visible: true })
  btn.set_relief(Gtk.ReliefStyle.NONE)
  btn.get_style_context().add_class('panel-row-btn')
  if (!entry.url) btn.set_sensitive(false)

  const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 5, visible: true })
  row.get_style_context().add_class('panel-row')
  btn.add(row)

  const artImg = new Gtk.Image({ visible: true })
  artImg.get_style_context().add_class('panel-art')
  artImg.set_valign(Gtk.Align.START)
  loadPanelArt(artImg, entry.coverPath)
  row.add(artImg)

  const col = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 1, visible: true })
  col.set_hexpand(true)
  row.add(col)

  const tLbl = new Gtk.Label({ label: stripZalgo(entry.title || '-'), visible: true, xalign: 0 })
  tLbl.get_style_context().add_class('panel-song-title')
  tLbl.set_ellipsize(3)
  tLbl.set_max_width_chars(18)
  col.add(fixedLineSlot(tLbl, 24, 18))

  const aLbl = new Gtk.Label({ label: stripZalgo(entry.artist || '-'), visible: true, xalign: 0 })
  aLbl.get_style_context().add_class('panel-song-artist')
  aLbl.set_ellipsize(3)
  aLbl.set_max_width_chars(18)
  col.add(fixedLineSlot(aLbl, 22, 16))

  const uLbl = new Gtk.Label({ label: entry.url ? fmtUrl(entry.url) : '', visible: true, xalign: 0 })
  uLbl.get_style_context().add_class('panel-url')
  uLbl.set_ellipsize(3)
  uLbl.set_max_width_chars(22)
  col.add(fixedLineSlot(uLbl, 17, 13))
  if (entry.url) {
    btn.connect('clicked', () => {
      execAsync(['xdg-open', entry.url]).catch(() => {})
    })
  }

  return btn
}

function buildLeftPanel(panel: any) {
  panel.set_size_request(260, -1)
  const hdr = new Gtk.Label({ label: 'TOP LISTENED', visible: true })
  hdr.get_style_context().add_class('panel-header')
  panel.add(hdr)
  panel.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 3, visible: true })
  panel.add(list)

  let lastSig = ''
  const rebuild = () => {
    const entries = getTopListened(5)

    const sig = entries.map(e => `${e.title}${e.artist}${e.totalSeconds}${e.completePlays}${e.partialPlays}`).join('')
    if (sig === lastSig) return
    lastSig = sig
    list.get_children().forEach((c: any) => c.destroy())
    for (let i = 0; i < 5; i++) list.add(buildTopListenedRow(entries[i] ?? null))
    list.show_all()
  }

  rebuild()
  const unsub = subscribeHistory(rebuild)
  panel.connect('destroy', unsub)
  panel.show_all()
}

function buildRightPanel(panel: any) {
  panel.set_size_request(260, -1)
  const hdr = new Gtk.Label({ label: 'RECENTLY PLAYED', visible: true })
  hdr.get_style_context().add_class('panel-header')
  panel.add(hdr)
  panel.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 3, visible: true })
  panel.add(list)

  let lastSig = ''
  const rebuild = () => {
    const entries = getRecent(5)

    const sig = entries.map(e => `${e.title}${e.artist}${e.url}`).join('')
    if (sig === lastSig) return
    lastSig = sig
    list.get_children().forEach((c: any) => c.destroy())
    for (let i = 0; i < 5; i++) list.add(buildRecentRow(entries[i] ?? null))
    list.show_all()
  }

  rebuild()
  const unsub = subscribeHistory(rebuild)
  panel.connect('destroy', unsub)
  panel.show_all()
}

type SidePill = 'left' | 'right'

const SIDE_PILL_BODY_WIDTH = 355
const SIDE_PILL_COMPACT_HEIGHT = 63
const SIDE_PILL_HORIZONTAL_INSET = 20
const SIDE_PILL_BOTTOM_OUTER_RADIUS = 14
const SIDE_PILL_BOTTOM_INNER_RADIUS = 50

function sidePillBodyPath(cr: any, width: number, height: number, side: SidePill): void {
  const left = SIDE_PILL_HORIZONTAL_INSET
  const right = width - SIDE_PILL_HORIZONTAL_INSET
  const bottomLeft = side === 'left'
    ? SIDE_PILL_BOTTOM_OUTER_RADIUS
    : Math.min(SIDE_PILL_BOTTOM_INNER_RADIUS, height - SIDE_PILL_HORIZONTAL_INSET)
  const bottomRight = side === 'right'
    ? SIDE_PILL_BOTTOM_OUTER_RADIUS
    : Math.min(SIDE_PILL_BOTTOM_INNER_RADIUS, height - SIDE_PILL_HORIZONTAL_INSET)

  cr.newPath()
  cr.moveTo(left, 0)
  cr.lineTo(right, 0)
  cr.lineTo(right, height - bottomRight)
  cr.arc(
    right - bottomRight,
    height - bottomRight,
    bottomRight,
    0,
    Math.PI / 2,
  )
  cr.lineTo(left + bottomLeft, height)
  cr.arc(
    left + bottomLeft,
    height - bottomLeft,
    bottomLeft,
    Math.PI / 2,
    Math.PI,
  )
  cr.lineTo(left, 0)
  cr.closePath()
}

function attachSidePillShape(widget: Gtk.Box, side: SidePill): void {
  widget.set_app_paintable(true)
  widget.connect('draw', (self: Gtk.Box, cr: any) => {
    const width = self.get_allocated_width()
    const height = self.get_allocated_height()
    if (width <= 0 || height <= 0) return false

    sidePillBodyPath(cr, width, height, side)
    cr.setSourceRGB(0x12 / 255, 0x12 / 255, 0x12 / 255)
    cr.fillPreserve()
    cr.setLineWidth(1)
    cr.setSourceRGB(0x2a / 255, 0x2a / 255, 0x2a / 255)
    cr.stroke()

    return false
  })
}

export default function MusicBar(gdkmonitor: Gdk.Monitor) {
  let win: Astal.Window
  let unregisterVisibility = () => {}
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  const mpris = AstalMpris.get_default()
  const monitorWidth = gdkmonitor.get_geometry().width
  const sidePillWidth = Math.max(
    180,
    Math.min(SIDE_PILL_BODY_WIDTH + SIDE_PILL_HORIZONTAL_INSET * 2, Math.floor(monitorWidth / 3) - 4),
  )

  const [activePlayer, setActivePlayer] = createState<AstalMpris.Player | null>(null)
  let currentPlayerRef: AstalMpris.Player | null = null
  const playerStatusSignals = new Map<AstalMpris.Player, number>()
  const refreshRetryIds = new Set<number>()
  let missingPlayerId: number | null = null

  const cancelMissingPlayerGrace = () => {
    if (missingPlayerId === null) return
    GLib.source_remove(missingPlayerId)
    missingPlayerId = null
  }

  const refresh = (forceMissing = false) => {
    try {
      const players: AstalMpris.Player[] = mpris.get_players() as any ?? []
      if (players.length === 0 && currentPlayerRef !== null && !forceMissing) {
        if (missingPlayerId === null) {
          missingPlayerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            missingPlayerId = null
            refresh(true)
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
          playerStatusSignals.set(player, player.connect('notify::playback-status', () => refresh()))
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
      currentPlayerRef = next
      if (FN_DEBUG) console.log(`[MusicBar] refresh: → ${next?.bus_name ?? 'null'}`)
      setActivePlayer(next)
    } catch (e) {
      dwarn('[MusicBar] refresh error:', e)
      if (currentPlayerRef !== null) {
        if (missingPlayerId === null) {
          missingPlayerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            missingPlayerId = null
            refresh(true)
            return GLib.SOURCE_REMOVE
          })
        }
      }
    }
  }

  let addedId: any, closedId: any
  try { addedId  = mpris.connect('player-added',  () => refresh()) } catch (_) {}
  try { closedId = mpris.connect('player-closed', () => refresh()) } catch (_) {}
  const subPlayers = createBinding(mpris, 'players').subscribe(() => refresh())

  onCleanup(() => {
    try { if (addedId  != null) mpris.disconnect(addedId)  } catch (_) {}
    try { if (closedId != null) mpris.disconnect(closedId) } catch (_) {}
    for (const [player, signalId] of playerStatusSignals) {
      try { player.disconnect(signalId) } catch (_) {}
    }
    playerStatusSignals.clear()
    subPlayers()
    for (const id of refreshRetryIds) GLib.source_remove(id)
    refreshRetryIds.clear()
    cancelMissingPlayerGrace()
    unregisterVisibility()
    try { win?.destroy() } catch (_) {}
  })

  refresh()
  for (const delay of [400, 1800]) {
    let id = 0
    id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
      refreshRetryIds.delete(id)
      if (activePlayer() === null) refresh()
      return GLib.SOURCE_REMOVE
    })
    refreshRetryIds.add(id)
  }

  ensureListenTrackerStarted()

  if (!LOW_END) ensureCavaStarted()
  let mainSpecDA: any = null
  let specAlive = true

  let centerAsleep = false
  const sleepCenter = () => { centerAsleep = true;  try { mainSpecDA?.queue_draw() } catch (_) {} }
  const wakeCenter  = () => { centerAsleep = false; try { mainSpecDA?.queue_draw() } catch (_) {} }
  let specPollId: number | null = null
  const startSpecPoll = (hz: number) => {
    if (LOW_END) return
    if (specPollId !== null) GLib.source_remove(specPollId)
    const interval = Math.max(16, Math.round(1000 / Math.max(1, hz)))
    specPollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
      if (!specAlive) return GLib.SOURCE_REMOVE
      if (!centerAsleep) try { mainSpecDA?.queue_draw() } catch (_) {}
      return GLib.SOURCE_CONTINUE
    })
  }
  startSpecPoll(REFRESH_HZ)
  const unsubscribeCavaRefresh = subscribeCavaRefresh(startSpecPoll)
  onCleanup(() => {
    specAlive = false
    unsubscribeCavaRefresh()
    if (specPollId !== null) GLib.source_remove(specPollId)
  })

  return (
    <window
      $={(self: any) => {
        win = self
        unregisterVisibility()
        unregisterVisibility = registerMusicBarController({ show: () => self.show(), hide: () => self.hide() })
      }}
      visible
      name="ags-music-bar" class="MusicBar" namespace="ags-music-bar"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
    >
      <box class="music-3pill-root" hexpand homogeneous={true}>

        <box hexpand halign={Gtk.Align.START} valign={Gtk.Align.START}>
        <box class="m-left-pill" spacing={8} valign={Gtk.Align.START}
          $={(leftPill: any) => {
            leftPill.set_size_request(
              sidePillWidth,
              SIDE_PILL_COMPACT_HEIGHT,
            )
            attachSidePillShape(leftPill, 'left')
            let flyout: FlyoutHandle | null = null
            let flyoutPlayer: AstalMpris.Player | null = null

            const closeNowPlaying = () => {
              if (!flyout) return
              const current = flyout
              flyout = null
              flyoutPlayer = null
              current.close()
            }

            const openNowPlaying = (player: AstalMpris.Player) => {
              const content = buildNowPlayingContent(player, gdkmonitor)
              flyoutPlayer = player
              flyout = openFlyoutWin(
                gdkmonitor,
                content,
                () => {
                  flyout = null
                  flyoutPlayer = null
                  wakeCenter()
                },
                0,
                "ags-now-listening",
              )
              sleepCenter()
            }

            const toggleFlyout = () => {
              if (flyout) closeNowPlaying()
              else {
                const player = activePlayer()
                if (!player) return
                openNowPlaying(player)
              }
            }
            _npToggles.set(gdkmonitor, toggleFlyout)
            leftPill.connect('destroy', () => {
              if (_npToggles.get(gdkmonitor) === toggleFlyout) _npToggles.delete(gdkmonitor)
              closeNowPlaying()
            })

            createEffect(() => {
              const player = activePlayer()
              if (FN_DEBUG) console.log(`[MusicBar] effect: bus=${player?.bus_name ?? 'null'}`)
              leftPill.get_children().forEach((c: any) => c.destroy())

              if (!player) {
                closeNowPlaying()
                leftPill.hide(); return
              }
              leftPill.show()

              if (flyout && flyoutPlayer !== player) {
                flyoutPlayer = player
                flyout.replaceContent(buildNowPlayingContent(player, gdkmonitor))
              }

              const npBtn = (<button class="now-playing-btn"
                tooltip_text="Open now playing"
                $={(self: any) => {
                  self.set_relief(Gtk.ReliefStyle.NONE)
                  self.set_can_focus(true)
                  self.get_accessible()?.set_name('Open now playing')
                  self.set_hexpand(true)
                  self.connect('clicked', toggleFlyout)
                }}
              >
                <box spacing={8} halign={Gtk.Align.START} valign={Gtk.Align.CENTER}>
                  <AlbumArt  player={player} />
                  {sidePillWidth >= 220 && <MediaInfo player={player} />}
                </box>
              </button>) as Gtk.Widget

              const ctrl = (<MediaControls player={player} />) as Gtk.Widget
              ctrl.set_halign(Gtk.Align.END)
              if (sidePillWidth < 330) ctrl.set_visible(false)

              leftPill.add(npBtn)
              leftPill.add(ctrl)
              leftPill.show_all()
            })
          }}
        />
        </box>

        {}
        <box hexpand halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
        <box class="m-center-pill" valign={Gtk.Align.CENTER} halign={Gtk.Align.CENTER}
          $={(centerPill: any) => {
            const specDA = new Gtk.DrawingArea({ visible: true })

            specDA.set_size_request(LOW_END ? 190 : NUM_BARS * 7, 22)
            specDA.set_halign(Gtk.Align.CENTER)
            specDA.set_valign(Gtk.Align.CENTER)
            specDA.connect('draw', (_w: any, cr: any) => {
              const dw = specDA.get_allocated_width(), dh = specDA.get_allocated_height()
              if (LOW_END)      drawLowEndText(cr, dw, dh)
              else if (centerAsleep) drawAsleepDashes(cr, dw, dh)
              else              drawLevelSpectrum(cr, dw, dh, NUM_BARS)
              return false
            })
            centerPill.add(specDA)
            centerPill.show_all()
            mainSpecDA = specDA
            createEffect(() => {
              const player = activePlayer()
              if (!player) { centerPill.hide(); return }
              centerPill.show()
            })
          }}
        />
        </box>

        {}
        <box hexpand halign={Gtk.Align.END} valign={Gtk.Align.START}>
        <box class="m-right-pill" spacing={8} valign={Gtk.Align.START}
          $={(rightPill: any) => {
            rightPill.set_size_request(
              sidePillWidth,
              SIDE_PILL_COMPACT_HEIGHT,
            )
            attachSidePillShape(rightPill, 'right')
            createEffect(() => {
              const player = activePlayer()
              rightPill.get_children().forEach((c: any) => c.destroy())

              if (!player) { rightPill.hide(); return }
              rightPill.show()

              const lv = (<LyricsViewer player={player} gdkmonitor={gdkmonitor} />) as Gtk.Widget
              rightPill.add(lv)

              rightPill.show_all()
            })
          }}
        />
        </box>

      </box>
    </window>
  )
}
