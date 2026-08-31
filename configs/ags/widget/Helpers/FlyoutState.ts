// Flyout State
let activeFlyouts = 0

const escapeDismissers = new Set<() => void>()

export const FLYOUT_WINDOW_CLASSES = [
  "AudioMixerMenuWindow",
  "WifiMenuWindow",
  "CalendarPopup",
  "BarFlyoutWindow",
  "FlyoutWindow",
  "CommandCenter",
  "NotifCenter",
  "PowerMenu",
  "SettingsPanel",
  "DashboardPanel",
  "AppLauncher",
  "KeybindsViewer",
]

interface PendingAudioOsd {
  volume: number
  expiresAt: number
}

interface PendingAudioMuteOsd {
  muted: boolean
  expiresAt: number
}

const pendingAudioOsd = new Map<number, PendingAudioOsd>()
const pendingAudioMuteOsd = new Map<number, PendingAudioMuteOsd>()
const latestUserAudio = new Map<number, { createdAt: number; expiresAt: number }>()
const AUDIO_NOTIFICATION_TIMEOUT_MS = 3000
const USER_INTENT_TIMEOUT_MS = 5000

export function isFlyoutWindow(window: any): boolean {
  try {
    const context = window.get_style_context()
    return FLYOUT_WINDOW_CLASSES.some(className => context.has_class(className))
  } catch (_) {
    return false
  }
}

export function registerFlyout(): () => void {
  activeFlyouts += 1
  let registered = true

  return () => {
    if (!registered) return
    registered = false
    activeFlyouts = Math.max(0, activeFlyouts - 1)
  }
}

export function trackFlyoutWindow(window: any): () => void {
  let release: (() => void) | null = null
  let disposed = false

  const sync = () => {
    if (disposed) return
    let visible = false
    try { visible = window.get_visible() } catch (_) {}

    if (visible && release === null) {
      release = registerFlyout()
    } else if (!visible && release !== null) {
      const currentRelease = release
      release = null
      currentRelease()
    }
  }

  let signalId: number | null = null
  try { signalId = window.connect("notify::visible", sync) } catch (_) {}
  sync()

  return () => {
    if (disposed) return
    disposed = true
    if (signalId !== null) {
      try { window.disconnect(signalId) } catch (_) {}
      signalId = null
    }
    if (release !== null) {
      const currentRelease = release
      release = null
      currentRelease()
    }
  }
}

export function trackEscapeDismiss(window: any, dismiss: () => void): () => void {
  let registered = false
  let disposed = false
  let visibleSignal: number | null = null
  let destroySignal: number | null = null

  const sync = () => {
    if (disposed) return

    let visible = false
    try { visible = window.get_visible() } catch (_) {}

    if (visible && !registered) {
      escapeDismissers.add(dismiss)
      registered = true
    } else if (!visible && registered) {
      escapeDismissers.delete(dismiss)
      registered = false
    }
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    escapeDismissers.delete(dismiss)
    registered = false

    if (visibleSignal !== null) {
      try { window.disconnect(visibleSignal) } catch (_) {}
      visibleSignal = null
    }
    if (destroySignal !== null) {
      try { window.disconnect(destroySignal) } catch (_) {}
      destroySignal = null
    }
  }

  try { visibleSignal = window.connect("notify::visible", sync) } catch (_) {}
  try { destroySignal = window.connect("destroy", dispose) } catch (_) {}
  sync()
  return dispose
}

export function dismissEscapeFlyouts(): number {
  const dismissers = [...escapeDismissers]
  for (const dismiss of dismissers) {
    try { dismiss() } catch (_) {}
  }
  return dismissers.length
}

export function markFlyoutAudioVolume(nodeId: number, volume: number): void {
  markAudioUserVolume(nodeId)
  pendingAudioOsd.set(nodeId, {
    volume,
    expiresAt: Date.now() + AUDIO_NOTIFICATION_TIMEOUT_MS,
  })
}

export function markAudioUserVolume(nodeId: number): void {
  if (!Number.isFinite(nodeId)) return
  const now = Date.now()
  latestUserAudio.set(nodeId, { createdAt: now, expiresAt: now + USER_INTENT_TIMEOUT_MS })
}

export function hasAudioUserVolumeSince(nodeId: number, since: number): boolean {
  const intent = latestUserAudio.get(nodeId)
  if (!intent) return false
  if (intent.expiresAt <= Date.now()) {
    latestUserAudio.delete(nodeId)
    return false
  }
  return intent.createdAt >= since
}

export function consumeFlyoutAudioOsd(nodeId: number, volume: number): boolean {
  const pending = pendingAudioOsd.get(nodeId)
  if (!pending) return false
  if (Date.now() >= pending.expiresAt) {
    pendingAudioOsd.delete(nodeId)
    return false
  }
  if (Math.abs(pending.volume - volume) >= 0.006) {
    if (activeFlyouts === 0) pendingAudioOsd.delete(nodeId)
    return false
  }

  if (activeFlyouts === 0) pendingAudioOsd.delete(nodeId)
  return true
}

export function markFlyoutAudioMute(nodeId: number, muted: boolean): void {
  if (!Number.isFinite(nodeId)) return
  pendingAudioMuteOsd.set(nodeId, {
    muted,
    expiresAt: Date.now() + AUDIO_NOTIFICATION_TIMEOUT_MS,
  })
}

export function consumeFlyoutAudioMuteOsd(nodeId: number, muted: boolean): boolean {
  const pending = pendingAudioMuteOsd.get(nodeId)
  if (!pending) return false
  if (Date.now() >= pending.expiresAt) {
    pendingAudioMuteOsd.delete(nodeId)
    return false
  }
  if (pending.muted !== muted) {
    if (activeFlyouts === 0) pendingAudioMuteOsd.delete(nodeId)
    return false
  }
  if (activeFlyouts === 0) pendingAudioMuteOsd.delete(nodeId)
  return true
}
