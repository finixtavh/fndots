// Network Flyout Layout
import GLib from "gi://GLib"
import { Gdk } from "ags/gtk3"
import { REDUCED_MOTION } from "./Perf"
import { loadSettings } from "./UserSettings"

export type NetworkFlyoutKind = 'wifi' | 'bluetooth'

type FlyoutEntry = {
  kind: NetworkFlyoutKind
  window: any
  monitor: Gdk.Monitor
  width: number
  order: number
  animationId: number | null
  sizeId: number | null
  active: boolean
}

export type NetworkFlyoutRegistration = {
  unregister: () => void
  revealDelayMs: number
}

const GAP_PX = 5
const EDGE_ALLOWANCE_PX = 4
const WIDTH_EXTENSION_PX = 100
const MOVE_MS = REDUCED_MOTION ? 0 : 160
const FRAME_MS = 16
const entries: FlyoutEntry[] = []
let nextOrder = 1

export function networkFlyoutLayoutEnabled(): boolean {
  return loadSettings().networkFlyoutReorder !== false
}

export function networkFlyoutWidth(monitor: Gdk.Monitor, managed: boolean): number {
  const geo = monitor.get_geometry()
  const natural = Math.min(360, Math.max(300, Math.floor(geo.width * 0.30)))
    + WIDTH_EXTENSION_PX
  if (!managed) return natural

  const pairedLimit = Math.max(1, Math.floor((geo.width - GAP_PX - EDGE_ALLOWANCE_PX) / 2))
  return Math.max(1, Math.min(natural, pairedLimit))
}

function stopAnimation(entry: FlyoutEntry) {
  if (entry.animationId == null) return
  try { GLib.source_remove(entry.animationId) } catch (_) {}
  entry.animationId = null
}

function applyMargin(entry: FlyoutEntry, margin: number) {
  try { entry.window.set_margin_right(Math.max(0, Math.round(margin))) } catch (_) {}
}

function animateMargin(entry: FlyoutEntry, target: number) {
  stopAnimation(entry)
  const start = Number(entry.window.get_margin_right?.() ?? 0)
  if (MOVE_MS === 0 || Math.abs(start - target) < 1) {
    applyMargin(entry, target)
    return
  }

  const startedAt = GLib.get_monotonic_time() / 1000
  entry.animationId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS, () => {
    if (!entry.active) {
      entry.animationId = null
      return GLib.SOURCE_REMOVE
    }
    const elapsed = GLib.get_monotonic_time() / 1000 - startedAt
    const progress = Math.min(1, elapsed / MOVE_MS)
    const eased = 1 - Math.pow(1 - progress, 3)
    applyMargin(entry, start + (target - start) * eased)
    if (progress < 1) return GLib.SOURCE_CONTINUE
    entry.animationId = null
    applyMargin(entry, target)
    return GLib.SOURCE_REMOVE
  })
}

function relayout(monitor: Gdk.Monitor) {
  const onMonitor = entries
    .filter(entry => entry.active && entry.monitor === monitor)
    .sort((a, b) => a.order - b.order)

  let offset = 0
  for (let index = onMonitor.length - 1; index >= 0; index--) {
    const entry = onMonitor[index]
    animateMargin(entry, offset)
    offset += entry.width + GAP_PX
  }
}

export function registerNetworkFlyout(
  kind: NetworkFlyoutKind,
  window: any,
  monitor: Gdk.Monitor,
  predictedWidth: number,
): NetworkFlyoutRegistration {
  const entry: FlyoutEntry = {
    kind,
    window,
    monitor,
    width: Math.max(1, Math.round(predictedWidth)),
    order: nextOrder++,
    animationId: null,
    sizeId: null,
    active: true,
  }
  entries.push(entry)
  relayout(monitor)

  try {
    entry.sizeId = window.connect('size-allocate', (_window: any, allocation: any) => {
      const measuredWidth = Math.round(Number(allocation?.width))
      if (!Number.isFinite(measuredWidth) || measuredWidth < 100) return
      const width = measuredWidth
      if (width === entry.width) return
      entry.width = width
      relayout(monitor)
    })
  } catch (_) {}

  const unregister = () => {
    if (!entry.active) return
    entry.active = false
    stopAnimation(entry)
    if (entry.sizeId != null) {
      try { window.disconnect(entry.sizeId) } catch (_) {}
      entry.sizeId = null
    }
    const index = entries.indexOf(entry)
    if (index >= 0) entries.splice(index, 1)
    relayout(monitor)
  }

  return {
    unregister,
    revealDelayMs: MOVE_MS > 0 && entries.some(other =>
      other !== entry && other.active && other.monitor === monitor)
      ? MOVE_MS + 20
      : 30,
  }
}
