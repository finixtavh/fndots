// Audio Device Volumes
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { dwarn } from "./DashLog"

export type AudioDeviceKind = "output" | "input"

interface StoredDeviceVolume {
  volume: number
  label: string
  updatedAt: number
}

interface VolumeState {
  version: 1
  devices: Record<string, StoredDeviceVolume>
}

export interface AudioDeviceIdentity {
  key: string
  label: string
  legacyKeys?: string[]
}

export const NEW_DEVICE_VOLUME = 0.26

const HOME = GLib.get_home_dir()
const configuredStateHome = GLib.getenv("XDG_STATE_HOME")
const STATE_HOME = configuredStateHome && GLib.path_is_absolute(configuredStateHome)
  ? configuredStateHome
  : GLib.build_filenamev([HOME, ".local", "state"])
const STATE_DIR = GLib.build_filenamev([STATE_HOME, "ags"])
const STATE_FILE = GLib.build_filenamev([STATE_DIR, "audio-device-volumes.json"])
const decoder = new TextDecoder()
const encoder = new TextEncoder()
const MAX_DEVICE_ENTRIES = 128
const DEVICE_ENTRY_TTL_MS = 180 * 24 * 60 * 60 * 1000

const state: VolumeState = {
  version: 1,
  devices: {},
}

let writeTimer: number | null = null

function pruneState(now = Date.now()): boolean {
  let changed = false
  for (const [key, entry] of Object.entries(state.devices)) {
    if (entry.updatedAt > 0 && now - entry.updatedAt > DEVICE_ENTRY_TTL_MS) {
      delete state.devices[key]
      changed = true
    }
  }
  const entries = Object.entries(state.devices)
  if (entries.length > MAX_DEVICE_ENTRIES) {
    entries.sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(MAX_DEVICE_ENTRIES)
      .forEach(([key]) => { delete state.devices[key] })
    changed = true
  }
  return changed
}

function clampVolume(volume: number): number {
  const clamped = Math.min(1, Math.max(0, volume))
  return Math.round(clamped * 10_000) / 10_000
}

function pwProperty(object: any, key: string): string {
  try {
    const value = object?.get_pw_property?.(key)
    return value == null ? "" : String(value).trim()
  } catch (_) {
    return ""
  }
}

function loadState(): void {
  try {
    GLib.mkdir_with_parents(STATE_DIR, 0o700)
    GLib.chmod(STATE_DIR, 0o700)
    if (GLib.file_test(STATE_FILE, GLib.FileTest.EXISTS)) GLib.chmod(STATE_FILE, 0o600)
    const [ok, raw] = GLib.file_get_contents(STATE_FILE)
    if (!ok) return
    const parsed = JSON.parse(decoder.decode(raw))
    if (!parsed || parsed.version !== 1 || !parsed.devices
      || typeof parsed.devices !== "object" || Array.isArray(parsed.devices)) return

    let needsRewrite = false
    for (const [key, entry] of Object.entries(parsed.devices as Record<string, any>)) {
      if (!/^(output|input):/.test(key) || !entry || typeof entry !== "object") {
        needsRewrite = true
        continue
      }
      const volume = Number(entry?.volume)
      if (!Number.isFinite(volume)) { needsRewrite = true; continue }
      const normalizedVolume = clampVolume(volume)
      if (normalizedVolume !== volume) needsRewrite = true
      const rawUpdatedAt = Number(entry?.updatedAt)
      const updatedAt = Number.isFinite(rawUpdatedAt) && rawUpdatedAt >= 0 ? rawUpdatedAt : 0
      if (updatedAt !== rawUpdatedAt) needsRewrite = true
      state.devices[key] = {
        volume: normalizedVolume,
        label: typeof entry?.label === "string" ? entry.label : "",
        updatedAt,
      }
    }
    if (pruneState()) needsRewrite = true
    if (needsRewrite) scheduleWrite()
  } catch (error) {
    dwarn("[AudioDeviceVolumes] Could not load saved volumes:", error)
  }
}

function writeState(): void {
  writeTimer = null
  try {
    GLib.mkdir_with_parents(STATE_DIR, 0o700)
    GLib.chmod(STATE_DIR, 0o700)
    pruneState()
    Gio.File.new_for_path(STATE_FILE).replace_contents(
      encoder.encode(JSON.stringify(state, null, 2)),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
      null,
    )
    GLib.chmod(STATE_FILE, 0o600)
  } catch (error) {
    dwarn("[AudioDeviceVolumes] Could not save device volumes:", error)
  }
}

function scheduleWrite(): void {
  if (writeTimer !== null) return
  writeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
    writeState()
    return GLib.SOURCE_REMOVE
  })
}

export function identifyAudioDevice(node: any, kind: AudioDeviceKind): AudioDeviceIdentity | null {
  let device: any = null
  try { device = node?.get_device?.() ?? node?.device ?? null } catch (_) {}

  const bluetoothAddress = pwProperty(device, "api.bluez5.address")
    || pwProperty(node, "api.bluez5.address")
    || pwProperty(device, "bluez5.address")
    || pwProperty(node, "bluez5.address")
  const busId = pwProperty(device, "device.bus-id") || pwProperty(node, "device.bus-id")
  const deviceName = pwProperty(device, "device.name") || pwProperty(node, "device.name")
  const serial = pwProperty(device, "device.serial") || pwProperty(node, "device.serial")
  const alsaPath = pwProperty(node, "api.alsa.path")
  const nodeName = pwProperty(node, "node.name")
    || String(node?.get_name?.() ?? node?.name ?? "").trim()
  const candidates: Array<[string, string]> = [
    ["bluetooth", bluetoothAddress],
    ["bus-device", busId ? [busId, deviceName].filter(Boolean).join("|") : ""],
    ["serial-device", serial ? [serial, deviceName].filter(Boolean).join("|") : ""],
    ["alsa", pwProperty(node, "api.alsa.path")],
    ["device", deviceName],
    ["node", nodeName],
  ]
  const identity = candidates.find(([, value]) => value.length > 0)
  if (!identity) return null

  const label = String(
    node?.get_description?.()
      ?? node?.description
      ?? device?.get_description?.()
      ?? device?.description
      ?? identity[1],
  ).trim()

  return {
    key: `${kind}:${identity[0]}:${identity[1]}`,
    label,
    legacyKeys: [
      ["serial", serial], ["bluetooth", bluetoothAddress], ["bus", busId],
      ["device", deviceName], ["alsa", alsaPath], ["node", nodeName],
    ].filter(([, value]) => value.length > 0)
      .map(([type, value]) => `${kind}:${type}:${value}`),
  }
}

export function storedDeviceVolume(identity: AudioDeviceIdentity): number | null {
  let entry = state.devices[identity.key]
  if (!entry) {
    const legacyKey = identity.legacyKeys?.find(key => state.devices[key])
    if (legacyKey) {
      entry = state.devices[legacyKey]
      state.devices[identity.key] = { ...entry, label: identity.label }
      delete state.devices[legacyKey]
      scheduleWrite()
    }
  }
  return entry ? clampVolume(entry.volume) : null
}

export function rememberDeviceVolume(identity: AudioDeviceIdentity, volume: number): void {
  if (!Number.isFinite(volume)) return
  state.devices[identity.key] = {
    volume: clampVolume(volume),
    label: identity.label,
    updatedAt: Date.now(),
  }
  scheduleWrite()
}

export function forgetDeviceVolume(identity: AudioDeviceIdentity): void {
  if (!(identity.key in state.devices)) return
  delete state.devices[identity.key]
  scheduleWrite()
}

export function flushDeviceVolumes(): void {
  if (writeTimer !== null) {
    GLib.source_remove(writeTimer)
    writeTimer = null
  }
  writeState()
}

loadState()
