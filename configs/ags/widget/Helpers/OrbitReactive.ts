
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { execAsync } from "ags/process"
import { cavaData, ensureCavaStarted, NUM_BARS } from "./cava"
import { LOW_END } from "./Perf"
import { CONFIG_HOME } from "./Paths"
import { loadSettings } from "./UserSettings"
import { derr } from "./DashLog"

const _dec = new TextDecoder()

const CTL = 'orbit-wallpaper-control'
const ORBIT_DIR = GLib.build_filenamev([CONFIG_HOME, 'orbit-wallpaper-engine'])
const ORBIT_CONFIG = GLib.build_filenamev([ORBIT_DIR, 'config'])
const PALETTE_FILE = GLib.build_filenamev([ORBIT_DIR, 'palette-fndots'])

const BASE = { primary: '#89B19E', secondary: '#4D6B5C', surface: '#050505', error: '#D08B8B' }
const POLL_MS = 100
const WRITE_MIN_MS = 1100
const BOOTSTRAP_RETRY_MS = 60000

let timer: number | null = null
let enabledOverride: boolean | null = null
let energy = 0
let lastWriteMs = 0
let lastContent = ''
let lastBootstrapMs = 0
let bootstrapped = false
let ctlMissing = false

export function isOrbitReactiveEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride
  try { return loadSettings().orbitReactive !== false } catch (_) { return true }
}

export function setOrbitReactiveEnabled(on: boolean): void {
  enabledOverride = on
  if (on) { ensureOrbitReactiveStarted(); return }
  stopTimer()
  energy = 0
  try { writePalette(buildPalette(0)) } catch (_) {}
}

function ctlAvailable(): boolean {
  if (ctlMissing) return false
  try {
    if (!GLib.find_program_in_path(CTL)) { ctlMissing = true; return false }
  } catch (_) { ctlMissing = true; return false }
  return true
}

function toHexChannel(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
}

function scaleHex(hex: string, k: number): string {
  const r = parseInt(hex.slice(1, 3), 16) * k
  const g = parseInt(hex.slice(3, 5), 16) * k
  const b = parseInt(hex.slice(5, 7), 16) * k
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`
}

function buildPalette(e: number): string {
  const k = 0.55 + 0.45 * e
  const ks = 0.8 + 0.2 * e
  return `primary = "${scaleHex(BASE.primary, k)}"\n`
    + `secondary = "${scaleHex(BASE.secondary, k)}"\n`
    + `surface = "${scaleHex(BASE.surface, ks)}"\n`
    + `error = "${scaleHex(BASE.error, k)}"\n`
}

function writePaletteFile(content: string): void {
  Gio.File.new_for_path(PALETTE_FILE).replace_contents(
    new TextEncoder().encode(content),
    null, false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null,
  )
  lastContent = content
  lastWriteMs = Date.now()
}

function writePalette(content: string): void {
  if (content === lastContent) return
  try { writePaletteFile(content) } catch (_) {}
}

function sampleEnergy(): number {
  let sum = 0
  for (let i = 0; i < NUM_BARS; i++) {
    const v = Number(cavaData.bars[i]) || 0
    sum += Math.max(0, Math.min(255, v))
  }
  return sum / (NUM_BARS * 255)
}

function upsertKey(text: string, key: string, value: string): string {
  const re = new RegExp(`^${key}=.*$`, 'm')
  const line = `${key}=${value}`
  if (re.test(text)) return text.replace(re, line)
  return (text.length === 0 ? '' : `${text.replace(/\s*$/, '\n')}`) + `${line}\n`
}

function configValue(text: string, key: string): string | null {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return m ? m[1].trim() : null
}

function ensureBootstrapped(): void {
  if (bootstrapped) return
  const [ok, raw] = GLib.file_get_contents(ORBIT_CONFIG)
  if (!ok) throw new Error('orbit config missing')
  let text = _dec.decode(raw)
  if (configValue(text, 'ORBIT_WALLPAPER_FOLLOW_SYSTEM_PALETTE') === '1'
    && configValue(text, 'ORBIT_WALLPAPER_PALETTE_FILE') === PALETTE_FILE) {
    bootstrapped = true
    return
  }
  text = upsertKey(text, 'ORBIT_WALLPAPER_FOLLOW_SYSTEM_PALETTE', '1')
  text = upsertKey(text, 'ORBIT_WALLPAPER_PALETTE_FILE', PALETTE_FILE)
  Gio.File.new_for_path(ORBIT_CONFIG).replace_contents(
    new TextEncoder().encode(text),
    null, false,
    Gio.FileCreateFlags.REPLACE_DESTINATION,
    null,
  )
  execAsync([CTL, 'restart']).catch((e: any) => {
    try { derr('[OrbitReactive] restart failed:', String(e?.message ?? e)) } catch (_) {}
  })
  bootstrapped = true
}

function stopTimer(): void {
  if (timer !== null) {
    try { GLib.source_remove(timer) } catch (_) {}
    timer = null
  }
}

function tick(): boolean {
  try {
    if (enabledOverride === false) { stopTimer(); return GLib.SOURCE_REMOVE }
    const now = Date.now()
    if (!bootstrapped && now - lastBootstrapMs >= BOOTSTRAP_RETRY_MS) {
      lastBootstrapMs = now
      try { ensureBootstrapped() } catch (_) {}
    }
    const target = sampleEnergy()
    energy += (target - energy) * (target > energy ? 0.45 : 0.06)
    if (energy < 0.015) energy = 0
    if (now - lastWriteMs >= WRITE_MIN_MS) {
      writePalette(buildPalette(energy))
    }
  } catch (_) {}
  return GLib.SOURCE_CONTINUE
}

export function ensureOrbitReactiveStarted(): void {
  if (timer !== null) return
  if (LOW_END) return
  if (!isOrbitReactiveEnabled()) return
  if (!ctlAvailable()) {
    try { derr('[OrbitReactive] orbit-wallpaper-control not found, reactive palette disabled') } catch (_) {}
    return
  }
  try { ensureCavaStarted() } catch (_) {}
  timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, tick)
}
