// OSD
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"
import AstalHyprland from "gi://AstalHyprland"
import AstalWp from "gi://AstalWp"
import { dwarn, logFn } from "../Helpers/DashLog"
import { FN_DEBUG } from "../Helpers/FnLogCollector"
import { REDUCED_MOTION } from "../Helpers/Perf"
import {
  AudioDeviceIdentity,
  forgetDeviceVolume,
  flushDeviceVolumes,
  identifyAudioDevice,
  NEW_DEVICE_VOLUME,
  rememberDeviceVolume,
  storedDeviceVolume,
} from "../Helpers/AudioDeviceVolumes"
import { subscribeOsdEvents } from "../Helpers/OsdEvents"
import {
  consumeFlyoutAudioMuteOsd,
  consumeFlyoutAudioOsd,
  hasAudioUserVolumeSince,
  markAudioUserVolume,
} from "../Helpers/FlyoutState"

type OsdKind =
  | "output"
  | "input"
  | "brightness"
  | "keyboard"
  | "caps"

interface OsdRequest {
  key: string
  kind: OsdKind
  icon: string
  appIcon?: string
  value: number
  state?: boolean
  muted?: boolean
  text?: string
}

interface Card {
  request: OsdRequest
  view: MonitorView
  widget: Gtk.EventBox
  drawing: Gtk.DrawingArea
  label: Gtk.Label
  setIcon: (request: OsdRequest) => void
  touchedAt: number
  currentX: number
  fromX: number
  targetX: number
  xStarted: number
  xDuration: number
  displayValue: number
  fromValue: number
  targetValue: number
  valueStarted: number
  valueDuration: number
  opacity: number
  fromOpacity: number
  targetOpacity: number
  opacityStarted: number
  opacityDuration: number
  hideTimer: number | null
  hideAfterAnimation: boolean
  removing: boolean
}

interface MonitorView {
  monitor: Gdk.Monitor
  window: Astal.Window
  fixed: Gtk.Fixed
  width: number
  cards: Card[]
}

interface LightDevice {
  name: string
  current: string
  maximum: string
}

const decoder = new TextDecoder()

const CARD_HEIGHT = 220
const CARD_GAP = 10
const BODY_X = 46
const BODY_WIDTH = 80
const CARD_WIDTH = BODY_X + BODY_WIDTH
const PANEL_RADIUS = 14
const LOBE_Y = 33
const LOBE_WIDTH = BODY_X
const LOBE_HEIGHT = 54
const LOBE_INVERTED_RADIUS = 14
const BAR_HEIGHT = 50
const MAX_CARDS = 3

const VALUE_DURATION = 190
const MOVE_DURATION = 180
const FADE_IN_DURATION = 150
const FADE_OUT_DURATION = 200
const DISPLAY_DURATION = 1000

const ICONS: Record<OsdKind, string> = {
  output: "󰕾",
  input: "󰍬",
  brightness: "󰃠",
  keyboard: "󰌌",
  caps: "󰪛",
}

function pipewireProperty(node: any, key: string): string {
  try {
    const value = node?.get_pw_property?.(key)
    return value == null ? "" : String(value).trim()
  } catch (_) {
    return ""
  }
}

function applicationIconName(node: any): string | null {
  const mediaClass = node.get_media_class?.() ?? node.media_class
  if (mediaClass !== AstalWp.MediaClass.STREAM_OUTPUT_AUDIO
    && mediaClass !== AstalWp.MediaClass.STREAM_INPUT_AUDIO) return null

  const candidates = [
    pipewireProperty(node, "application.icon-name"),
    pipewireProperty(node, "application.id"),
    pipewireProperty(node, "application.process.binary"),
    String(node.icon ?? ""),
  ].flatMap(name => {
    const trimmed = name.trim()
    return trimmed ? [trimmed, trimmed.replace(/\.desktop$/i, "")] : []
  })
  const theme = Gtk.IconTheme.get_default()
  return candidates.find(name => {
    try { return Boolean(theme?.has_icon(name)) } catch (_) { return false }
  }) ?? null
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value))
}

function nowMs(): number {
  return GLib.get_monotonic_time() / 1000
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - clamp(value, 0, 1), 3)
}

function readInt(path: string): number {
  try {
    const [ok, raw] = GLib.file_get_contents(path)
    if (!ok) return 0
    const value = Number.parseInt(decoder.decode(raw).trim(), 10)
    return Number.isFinite(value) ? value : 0
  } catch (_) {
    return 0
  }
}

function directoryEntries(path: string): string[] {
  const result: string[] = []
  try {
    if (!GLib.file_test(path, GLib.FileTest.IS_DIR)) return result
    const directory = GLib.Dir.open(path, 0)
    let name = directory.read_name()
    while (name !== null) {
      result.push(name)
      name = directory.read_name()
    }
    directory.close()
  } catch (_) {}
  return result
}

function findBacklight(): LightDevice | null {
  for (const name of directoryEntries("/sys/class/backlight")) {
    const base = `/sys/class/backlight/${name}`

    const current = `${base}/brightness`
    const maximum = `${base}/max_brightness`
    if (GLib.file_test(current, GLib.FileTest.EXISTS)
      && GLib.file_test(maximum, GLib.FileTest.EXISTS)) {
      return { name, current, maximum }
    }
  }
  return null
}

function findKeyboardBacklight(): LightDevice | null {
  for (const name of directoryEntries("/sys/class/leds")) {
    if (!/(kbd|keyboard)[_-]?(backlight|back_light)/i.test(name)) continue
    const base = `/sys/class/leds/${name}`
    const current = `${base}/brightness`
    const maximum = `${base}/max_brightness`
    if (GLib.file_test(current, GLib.FileTest.EXISTS)
      && GLib.file_test(maximum, GLib.FileTest.EXISTS)) {
      return { name, current, maximum }
    }
  }
  return null
}

function lightPercent(device: LightDevice): number {
  const maximum = Math.max(1, readInt(device.maximum))
  return clamp(Math.round(readInt(device.current) * 100 / maximum))
}

function setLightStep(device: LightDevice, step: number): void {
  const amount = step > 0 ? "2%+" : "2%-"
  execAsync(["brightnessctl", "--device", device.name, "set", amount])
    .catch((error: any) => dwarn(`[OSD] Could not adjust ${device.name}:`, error))
}

function roundedRectangle(cr: any, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2)
  cr.newSubPath()
  cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0)
  cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2)
  cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI)
  cr.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
  cr.closePath()
}

function iconBoxPath(cr: any): void {
  const left = 0
  const right = LOBE_WIDTH
  const top = LOBE_Y
  const bottom = LOBE_Y + LOBE_HEIGHT
  const outerRadius = PANEL_RADIUS
  const inverted = LOBE_INVERTED_RADIUS

  cr.newPath()
  cr.moveTo(right, top - inverted)

  cr.curveTo(
    right, top - inverted / 3,
    right - inverted / 3, top,
    right - inverted, top,
  )
  cr.lineTo(left + outerRadius, top)
  cr.curveTo(left + 6, top, left, top + 6, left, top + outerRadius)
  cr.lineTo(left, bottom - outerRadius)
  cr.curveTo(left, bottom - 6, left + 6, bottom, left + outerRadius, bottom)
  cr.lineTo(right - inverted, bottom)

  cr.curveTo(
    right - inverted / 3, bottom,
    right, bottom + inverted / 3,
    right, bottom + inverted,
  )

  cr.lineTo(right, top - inverted)
  cr.closePath()
}

function drawCard(card: Card, cr: any): boolean {

  roundedRectangle(cr, BODY_X, 0, BODY_WIDTH, CARD_HEIGHT, PANEL_RADIUS)
  cr.setSourceRGB(0x12 / 255, 0x12 / 255, 0x12 / 255)
  cr.fillPreserve()
  cr.setLineWidth(1)
  cr.setSourceRGB(0x2a / 255, 0x2a / 255, 0x2a / 255)
  cr.stroke()

  iconBoxPath(cr)
  cr.setSourceRGB(0x12 / 255, 0x12 / 255, 0x12 / 255)
  cr.fill()

  cr.newPath()
  cr.moveTo(BODY_X, LOBE_Y - LOBE_INVERTED_RADIUS)
  cr.lineTo(BODY_X, LOBE_Y + LOBE_HEIGHT + LOBE_INVERTED_RADIUS)
  cr.setLineWidth(3)
  cr.setSourceRGB(0x12 / 255, 0x12 / 255, 0x12 / 255)
  cr.stroke()

  const top = LOBE_Y
  const bottom = LOBE_Y + LOBE_HEIGHT
  const inverted = LOBE_INVERTED_RADIUS
  cr.newPath()
  cr.moveTo(LOBE_WIDTH, top - inverted)
  cr.curveTo(
    LOBE_WIDTH, top - inverted / 3,
    LOBE_WIDTH - inverted / 3, top,
    LOBE_WIDTH - inverted, top,
  )
  cr.lineTo(PANEL_RADIUS, top)
  cr.curveTo(6, top, 0, top + 6, 0, top + PANEL_RADIUS)
  cr.lineTo(0, bottom - PANEL_RADIUS)
  cr.curveTo(0, bottom - 6, 6, bottom, PANEL_RADIUS, bottom)
  cr.lineTo(LOBE_WIDTH - inverted, bottom)
  cr.curveTo(
    LOBE_WIDTH - inverted / 3, bottom,
    LOBE_WIDTH, bottom + inverted / 3,
    LOBE_WIDTH, bottom + inverted,
  )
  cr.setLineWidth(1)
  cr.setSourceRGB(0x2a / 255, 0x2a / 255, 0x2a / 255)
  cr.stroke()

  const gaugeX = BODY_X + 34
  const gaugeY = 22
  const gaugeWidth = 12
  const gaugeHeight = 154
  roundedRectangle(cr, gaugeX, gaugeY, gaugeWidth, gaugeHeight, gaugeWidth / 2)
  cr.setSourceRGB(0x2a / 255, 0x2a / 255, 0x2a / 255)
  cr.fill()

  const fraction = clamp(card.displayValue) / 100
  const fillHeight = gaugeHeight * fraction
  if (fillHeight > 0.1) {
    roundedRectangle(
      cr,
      gaugeX,
      gaugeY + gaugeHeight - fillHeight,
      gaugeWidth,
      fillHeight,
      Math.min(gaugeWidth / 2, fillHeight / 2),
    )
    if (card.request.muted || card.request.state === false) {
      cr.setSourceRGB(0x70 / 255, 0x70 / 255, 0x70 / 255)
    } else {
      cr.setSourceRGB(0x89 / 255, 0xb1 / 255, 0x9e / 255)
    }
    cr.fill()
  }
  return false
}

export default function OSD(monitors: Gdk.Monitor[]) {
  const views: MonitorView[] = []
  const cardsByKey = new Map<string, Card>()
  const anonymousNodeIds = new WeakMap<object, number>()
  let nextAnonymousNodeId = 1
  const signalCleanups: Array<() => void> = []
  const pollIds: number[] = []
  let animationId: number | null = null
  let stopped = false
  const explicitMuteAt: Record<'output' | 'input', number> = { output: 0, input: 0 }

  const requestLabel = (request: OsdRequest): string => request.text
    ?? (request.state === undefined
      ? `${Math.round(request.value)}%`
      : (request.state ? "On" : "Off"))

  const monitorAtPointer = (): MonitorView => {
    try {
      const display = Gdk.Display.get_default()
      const pointer = display?.get_device_manager()?.get_client_pointer()
      const [, x, y] = pointer?.get_position() ?? [null, 0, 0]
      const monitor = display?.get_monitor_at_point(x, y)
      const exact = views.find(view => view.monitor === monitor)
      if (exact) return exact
      const containing = views.find(view => {
        const geometry = view.monitor.get_geometry()
        return x >= geometry.x && x < geometry.x + geometry.width
          && y >= geometry.y && y < geometry.y + geometry.height
      })
      if (containing) return containing
    } catch (_) {}
    return views[0]
  }

  const valueAt = (
    from: number,
    target: number,
    started: number,
    duration: number,
    now: number,
  ): number => {
    if (duration <= 0) return target
    return from + (target - from) * easeOutCubic((now - started) / duration)
  }

  const removeCard = (card: Card) => {
    if (card.hideTimer !== null) {
      GLib.source_remove(card.hideTimer)
      card.hideTimer = null
    }
    cardsByKey.delete(card.request.key)
    card.view.cards = card.view.cards.filter(item => item !== card)
    try { card.view.fixed.remove(card.widget) } catch (_) {}
    try { card.widget.destroy() } catch (_) {}
    if (FN_DEBUG) logFn("AGS", "debug", `OSD removed: ${card.request.kind}`)
    layoutView(card.view)
    if (card.view.cards.length === 0) card.view.window.hide()
  }

  const expireCard = (card: Card) => {
    if (card.removing) return
    card.removing = true
    card.hideAfterAnimation = false
    card.hideTimer = null
    if (REDUCED_MOTION) {
      removeCard(card)
      return
    }
    const now = nowMs()
    card.fromOpacity = card.opacity
    card.targetOpacity = 0
    card.opacityStarted = now
    card.opacityDuration = FADE_OUT_DURATION
    ensureAnimation()
  }

  const scheduleHide = (card: Card) => {
    if (card.removing || card.hideTimer !== null) return
    card.hideAfterAnimation = false
    card.hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DISPLAY_DURATION, () => {
      card.hideTimer = null
      expireCard(card)
      return GLib.SOURCE_REMOVE
    })
  }

  function tick(): boolean {
    const now = nowMs()
    let needsAnotherTick = false
    const finished: Card[] = []

    for (const view of views) {
      for (const card of view.cards) {
        if (card.xDuration > 0) {
          const elapsed = now - card.xStarted
          card.currentX = valueAt(card.fromX, card.targetX, card.xStarted, card.xDuration, now)
          card.view.fixed.move(card.widget, Math.round(card.currentX), 0)
          if (elapsed >= card.xDuration) {
            card.currentX = card.targetX
            card.xDuration = 0
            card.view.fixed.move(card.widget, Math.round(card.currentX), 0)
          } else {
            needsAnotherTick = true
          }
        }

        if (card.valueDuration > 0) {
          const elapsed = now - card.valueStarted
          card.displayValue = valueAt(
            card.fromValue,
            card.targetValue,
            card.valueStarted,
            card.valueDuration,
            now,
          )
          card.drawing.queue_draw()
          if (elapsed >= card.valueDuration) {
            card.displayValue = card.targetValue
            card.valueDuration = 0
            card.drawing.queue_draw()
          } else {
            needsAnotherTick = true
          }
        }

        if (card.opacityDuration > 0) {
          const elapsed = now - card.opacityStarted
          card.opacity = valueAt(
            card.fromOpacity,
            card.targetOpacity,
            card.opacityStarted,
            card.opacityDuration,
            now,
          )
          card.widget.set_opacity(card.opacity)
          if (elapsed >= card.opacityDuration) {
            card.opacity = card.targetOpacity
            card.opacityDuration = 0
            card.widget.set_opacity(card.opacity)
            if (card.removing && card.opacity <= 0) finished.push(card)
          } else {
            needsAnotherTick = true
          }
        }

        if (card.hideAfterAnimation
          && card.valueDuration === 0
          && card.opacityDuration === 0
          && !card.removing) {
          scheduleHide(card)
        }
      }
    }

    for (const card of finished) removeCard(card)

    if (!needsAnotherTick) {
      animationId = null
      return GLib.SOURCE_REMOVE
    }
    return GLib.SOURCE_CONTINUE
  }

  function ensureAnimation(): void {
    if (REDUCED_MOTION || animationId !== null) return
    animationId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, tick)
  }

  function moveCard(card: Card, target: number): void {
    if (REDUCED_MOTION) {
      card.currentX = target
      card.targetX = target
      card.xDuration = 0
      card.view.fixed.move(card.widget, Math.round(target), 0)
      return
    }
    const now = nowMs()
    card.currentX = valueAt(card.fromX, card.targetX, card.xStarted, card.xDuration, now)
    card.fromX = card.currentX
    card.targetX = target
    card.xStarted = now
    card.xDuration = Math.abs(card.currentX - target) < 0.5 ? 0 : MOVE_DURATION
    if (card.xDuration === 0) card.view.fixed.move(card.widget, Math.round(target), 0)
    else ensureAnimation()
  }

  function layoutView(view: MonitorView, newCard?: Card): void {
    const count = view.cards.length
    if (count === 0) return
    const totalWidth = count * CARD_WIDTH + (count - 1) * CARD_GAP
    const start = Math.round((view.width - totalWidth) / 2)
    view.cards.forEach((card, index) => {
      const target = start + index * (CARD_WIDTH + CARD_GAP)
      if (card === newCard && !REDUCED_MOTION) {
        card.currentX = target + 10
        card.fromX = card.currentX
        card.targetX = card.currentX
        card.view.fixed.move(card.widget, Math.round(card.currentX), 0)
      }
      moveCard(card, target)
    })
  }

  const createCard = (view: MonitorView, request: OsdRequest): Card => {
    const drawing = new Gtk.DrawingArea({ visible: true })
    drawing.set_size_request(CARD_WIDTH, CARD_HEIGHT)

    const iconLabel = new Gtk.Label({
      label: request.icon,
      visible: true,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      xalign: 0.5,
      yalign: 0.5,
    })
    iconLabel.get_style_context().add_class("osd-card-icon")

    const appIcon = new Gtk.Image({
      pixel_size: 24,
      visible: true,
    })
    appIcon.get_style_context().add_class("osd-card-app-icon")

    const iconStack = new Gtk.Stack({
      transition_type: Gtk.StackTransitionType.NONE,
      visible: true,
    })
    iconStack.add_named(iconLabel, "glyph")
    iconStack.add_named(appIcon, "application")
    iconStack.set_size_request(BODY_X, LOBE_HEIGHT)

    const setIcon = (next: OsdRequest) => {
      iconLabel.set_label(next.icon)
      if (next.appIcon) {
        appIcon.set_from_icon_name(next.appIcon, Gtk.IconSize.DIALOG)
        appIcon.set_pixel_size(24)
        iconStack.set_visible_child_name("application")
      } else {
        iconStack.set_visible_child_name("glyph")
      }
    }
    setIcon(request)

    const label = new Gtk.Label({
      label: requestLabel(request),
      visible: true,
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      xalign: 0.5,
    })
    label.get_style_context().add_class("osd-card-value")
    label.set_size_request(BODY_WIDTH, 28)

    const content = new Gtk.Fixed({ visible: true })
    content.set_size_request(CARD_WIDTH, CARD_HEIGHT)
    content.put(drawing, 0, 0)
    content.put(iconStack, 0, LOBE_Y)
    content.put(label, BODY_X, 186)

    const eventBox = new Gtk.EventBox({ visible: true, visible_window: true })
    eventBox.get_style_context().add_class("osd-card-event")
    eventBox.set_size_request(CARD_WIDTH, CARD_HEIGHT)
    eventBox.add_events(Gdk.EventMask.SCROLL_MASK | Gdk.EventMask.SMOOTH_SCROLL_MASK)
    eventBox.add(content)

    const now = nowMs()
    const card: Card = {
      request,
      view,
      widget: eventBox,
      drawing,
      label,
      setIcon,
      touchedAt: now,
      currentX: 0,
      fromX: 0,
      targetX: 0,
      xStarted: now,
      xDuration: 0,
      displayValue: request.value,
      fromValue: request.value,
      targetValue: request.value,
      valueStarted: now,
      valueDuration: 0,
      opacity: REDUCED_MOTION ? 1 : 0,
      fromOpacity: REDUCED_MOTION ? 1 : 0,
      targetOpacity: 1,
      opacityStarted: now,
      opacityDuration: REDUCED_MOTION ? 0 : FADE_IN_DURATION,
      hideTimer: null,
      hideAfterAnimation: true,
      removing: false,
    }

    drawing.connect("draw", (_widget: Gtk.DrawingArea, cr: any) => drawCard(card, cr))
    return card
  }

  const show = (request: OsdRequest): void => {
    request.value = clamp(request.value)
    let card = cardsByKey.get(request.key)
    const now = nowMs()

    if (card) {
      if (card.hideTimer !== null) {
        GLib.source_remove(card.hideTimer)
        card.hideTimer = null
      }
      card.removing = false
      card.hideAfterAnimation = true
      card.touchedAt = now
      card.request = request
      card.label.set_label(requestLabel(request))
      card.setIcon(request)

      if (REDUCED_MOTION) {
        card.displayValue = request.value
        card.targetValue = request.value
        card.valueDuration = 0
        card.opacity = 1
        card.opacityDuration = 0
        card.widget.set_opacity(1)
        card.drawing.queue_draw()
        scheduleHide(card)
      } else {
        card.displayValue = valueAt(
          card.fromValue,
          card.targetValue,
          card.valueStarted,
          card.valueDuration,
          now,
        )
        card.fromValue = card.displayValue
        card.targetValue = request.value
        card.valueStarted = now
        card.valueDuration = Math.abs(card.displayValue - request.value) < 0.1 ? 0 : VALUE_DURATION
        card.fromOpacity = card.opacity
        card.targetOpacity = 1
        card.opacityStarted = now
        card.opacityDuration = card.opacity < 0.99 ? FADE_IN_DURATION : 0
        card.drawing.queue_draw()
        if (card.valueDuration === 0 && card.opacityDuration === 0) scheduleHide(card)
        else ensureAnimation()
      }
      if (FN_DEBUG) logFn("AGS", "debug", `OSD updated: ${request.kind} ${Math.round(request.value)}%`)
      return
    }

    const allCards = [...cardsByKey.values()]
    if (allCards.length >= MAX_CARDS) {
      const oldest = allCards.reduce((left, right) =>
        left.touchedAt <= right.touchedAt ? left : right)
      if (FN_DEBUG) logFn("AGS", "debug", `OSD limit reached; replacing ${oldest.request.kind}`)
      removeCard(oldest)
    }

    const view = monitorAtPointer()
    card = createCard(view, request)
    cardsByKey.set(request.key, card)
    view.cards.push(card)
    view.fixed.put(card.widget, 0, 0)
    view.window.show_all()
    try { view.window.get_window()?.set_pass_through(true) } catch (_) {}
    layoutView(view, card)
    if (REDUCED_MOTION) scheduleHide(card)
    else ensureAnimation()
    if (FN_DEBUG) {
      const index = views.indexOf(view)
      logFn("AGS", "debug", `OSD shown: ${request.kind} on monitor ${index}`)
    }
  }

  for (const monitor of monitors) {
    const geometry = monitor.get_geometry()
    const fixed = new Gtk.Fixed({ visible: true })
    fixed.set_size_request(geometry.width, CARD_HEIGHT)

    const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor
    const window = new (Astal.Window as any)({
      namespace: "ags-osd",
      gdkmonitor: monitor,
      exclusivity: Astal.Exclusivity.IGNORE,
      layer: Astal.Layer.OVERLAY,
      anchor: BOTTOM | LEFT | RIGHT,
      margin_bottom: BAR_HEIGHT,
      keymode: Astal.Keymode.NONE,
      application: app,
    }) as Astal.Window
    window.get_style_context().add_class("OSD")
    window.set_size_request(geometry.width, CARD_HEIGHT)
    try {
      const visual = window.get_screen()?.get_rgba_visual()
      if (visual) window.set_visual(visual)
    } catch (_) {}
    window.add(fixed)
    try { Astal.widget_set_click_through(window, true) } catch (_) {}
    window.show_all()
    window.hide()
    views.push({ monitor, window, fixed, width: geometry.width, cards: [] })
  }

  const registerPoll = (callback: () => void, interval: number): void => {
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
      callback()
      return GLib.SOURCE_CONTINUE
    })
    pollIds.push(id)
  }

  const backlight = findBacklight()
  if (backlight) {
    let previous = lightPercent(backlight)
    registerPoll(() => {
      const current = lightPercent(backlight)
      if (current === previous) return
      previous = current
      show({
        key: "brightness",
        kind: "brightness",
        icon: ICONS.brightness,
        value: current,
      })
    }, 120)
  }

  const keyboardLight = findKeyboardBacklight()
  if (keyboardLight) {
    let previous = lightPercent(keyboardLight)
    registerPoll(() => {
      const current = lightPercent(keyboardLight)
      if (current === previous) return
      previous = current
      show({
        key: "keyboard",
        kind: "keyboard",
        icon: ICONS.keyboard,
        value: current,
      })
    }, 120)
  }

  let keymap: Gdk.Keymap | null = null
  let caps = false
  let showDefaultMute: ((kind: 'output' | 'input', force?: boolean) => void) | null = null
  try {
    const defaultKeymap = Gdk.Keymap.get_default()
    if (defaultKeymap) {
      keymap = defaultKeymap
      caps = defaultKeymap.get_caps_lock_state()
      const id = defaultKeymap.connect("state-changed", () => {
        const nextCaps = defaultKeymap.get_caps_lock_state()
        if (nextCaps !== caps) {
          caps = nextCaps
          show({ key: "caps", kind: "caps", icon: ICONS.caps, value: caps ? 100 : 0, state: caps })
        }
      })
      signalCleanups.push(() => { try { defaultKeymap.disconnect(id) } catch (_) {} })
    }
  } catch (error) {
    dwarn("[OSD] lock-key monitoring failed:", error)
  }

  const unsubscribeOsdEvents = subscribeOsdEvents(event => {
    if (event === 'caps') {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 45, () => {
        const next = keymap?.get_caps_lock_state() ?? caps
        caps = next
        show({
          key: 'caps', kind: 'caps', icon: ICONS.caps,
          value: next ? 100 : 0, state: next,
        })
        return GLib.SOURCE_REMOVE
      })
      return
    }
    const kind = event === 'output-mute' ? 'output' : 'input'
    explicitMuteAt[kind] = Date.now()
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
      showDefaultMute?.(kind, true)
      return GLib.SOURCE_REMOVE
    })
  })
  signalCleanups.push(unsubscribeOsdEvents)

  try {
    const wp = AstalWp.Wp.get_default()
    const audio = wp.get_audio()
    const watched = new Map<any, number[]>()

    showDefaultMute = (kind) => {
      const node = kind === 'output'
        ? audio.get_default_speaker()
        : audio.get_default_microphone()
      if (!node) return
      const muted = !!(node.get_mute?.() ?? node.mute)
      const volume = clamp(Number(node.get_volume?.() ?? node.volume ?? 0), 0, 1)
      show({
        key: `${kind}-mute`,
        kind,
        icon: ICONS[kind],
        value: muted ? 0 : Math.round(volume * 100),
        muted,
        state: !muted,
        text: muted ? 'Muted' : 'Active',
      })
    }

    const unregisterNode = (node: any) => {
      const ids = watched.get(node)
      if (!ids) return
      for (const id of ids) {
        try { node.disconnect(id) } catch (_) {}
      }
      watched.delete(node)
    }

    const nodeKind = (node: any): "output" | "input" | null => {
      const mediaClass = node.get_media_class?.() ?? node.media_class
      if (mediaClass === AstalWp.MediaClass.AUDIO_SINK
        || mediaClass === AstalWp.MediaClass.STREAM_OUTPUT_AUDIO) return "output"
      if (mediaClass === AstalWp.MediaClass.AUDIO_SOURCE
        || mediaClass === AstalWp.MediaClass.AUDIO_SOURCE_VIRTUAL
        || mediaClass === AstalWp.MediaClass.STREAM_INPUT_AUDIO) return "input"
      return null
    }

    const deviceIdentity = (
      node: any,
      kind: "output" | "input",
    ): AudioDeviceIdentity | null => {
      const mediaClass = node.get_media_class?.() ?? node.media_class
      if (mediaClass !== AstalWp.MediaClass.AUDIO_SINK
        && mediaClass !== AstalWp.MediaClass.AUDIO_SOURCE) return null

      const identity = identifyAudioDevice(node, kind)
      let device: any = null
      try { device = node.get_device?.() ?? node.device ?? null } catch (_) {}
      if (!device) {

        if (identity) forgetDeviceVolume(identity)
        return null
      }
      return identity
    }

    const registerNode = (node: any) => {
      if (!node || watched.has(node)) return
      const kind = nodeKind(node)
      if (!kind) return
      const serialCandidates = [
        Number(node.get_serial?.() ?? 0),
        Number(node.serial ?? 0),
        Number(node.id ?? 0),
      ]
      const stableId = serialCandidates.find(value => Number.isFinite(value) && value > 0)
      let nodeId = stableId ?? 0
      if (nodeId === 0 && typeof node === 'object') {
        nodeId = anonymousNodeIds.get(node) ?? nextAnonymousNodeId++
        anonymousNodeIds.set(node, nodeId)
      }
      const key = `${kind}:${stableId ? 'node' : 'anonymous'}:${nodeId}`
      const identity = deviceIdentity(node, kind)
      const savedVolume = identity ? storedDeviceVolume(identity) : null
      const restoredVolume = identity
        ? (savedVolume ?? NEW_DEVICE_VOLUME)
        : null
      let previousVolume = clamp(Number(node.get_volume?.() ?? node.volume ?? 0), 0, 1)
      let previousMute = !!(node.get_mute?.() ?? node.mute)
      let ready = false
      let initializingVolume = identity !== null
      const restoreStartedAt = Date.now()

      const initialVolume = Number(node.get_volume?.() ?? node.volume ?? 0)
      if (initialVolume > 1) {
        try { node.set_volume(1) } catch (_) {}
        previousVolume = 1
      }

      const showNode = () => {
        let volume = Number(node.get_volume?.() ?? node.volume ?? 0)
        const muted = !!(node.get_mute?.() ?? node.mute)
        if (volume > 1) {
          volume = 1
          try { node.set_volume(1) } catch (_) {}
        }
        show({
          key,
          kind,
          icon: ICONS[kind],
          appIcon: applicationIconName(node) ?? undefined,
          value: muted ? 0 : Math.round(clamp(volume, 0, 1) * 100),
          muted,
        })
      }

      const volumeId = node.connect("notify::volume", () => {
        let volume = Number(node.get_volume?.() ?? node.volume ?? 0)
        if (volume > 1) {
          volume = 1
          try { node.set_volume(1) } catch (_) {}
        }
        if (Math.abs(volume - previousVolume) < 0.001) return
        previousVolume = volume
        if (initializingVolume) {
          if (!hasAudioUserVolumeSince(Number(node.id), restoreStartedAt)) return
          initializingVolume = false
          ready = true
        }
        if (identity) rememberDeviceVolume(identity, volume)
        const suppressFlyoutChange = consumeFlyoutAudioOsd(Number(node.id), volume)
        if (ready && !suppressFlyoutChange) showNode()
      })
      const muteId = node.connect("notify::mute", () => {
        const muted = !!(node.get_mute?.() ?? node.mute)
        if (muted === previousMute) return
        previousMute = muted
        const suppressFlyoutChange = consumeFlyoutAudioMuteOsd(Number(node.id), muted)
        const explicitRequest = Date.now() - explicitMuteAt[kind] < 300
        const isDefault = node === (kind === 'output'
          ? audio.get_default_speaker()
          : audio.get_default_microphone())
        if (ready && isDefault && !suppressFlyoutChange && !explicitRequest) {
          showDefaultMute?.(kind)
        }
      })
      watched.set(node, [volumeId, muteId])

      if (identity && restoredVolume !== null) {

        if (savedVolume === null) rememberDeviceVolume(identity, restoredVolume)

        const applyRestoredVolume = (finish: boolean): boolean => {
          if (!watched.has(node)) return GLib.SOURCE_REMOVE
          if (hasAudioUserVolumeSince(Number(node.id), restoreStartedAt)) {
            initializingVolume = false
            ready = true
            return GLib.SOURCE_REMOVE
          }
          initializingVolume = true
          try {
            const current = clamp(Number(node.get_volume?.() ?? node.volume ?? 0), 0, 1)
            if (Math.abs(current - restoredVolume) >= 0.001) {
              node.set_volume(restoredVolume)
            }
            previousVolume = restoredVolume
          } catch (_) {}
          if (finish) {
            initializingVolume = false
            ready = true
            if (FN_DEBUG) {
              const action = savedVolume === null ? "defaulted" : "restored"
              logFn(
                "AGS",
                "debug",
                `Audio device ${action} to ${Math.round(restoredVolume * 100)}%: ${identity.label}`,
              )
            }
          }
          return GLib.SOURCE_REMOVE
        }

        applyRestoredVolume(false)
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => applyRestoredVolume(false))
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => applyRestoredVolume(false))
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1400, () => applyRestoredVolume(true))
      } else {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 450, () => {
          ready = watched.has(node)
          initializingVolume = false
          return GLib.SOURCE_REMOVE
        })
      }
    }

    for (const node of audio.get_speakers() ?? []) registerNode(node)
    for (const node of audio.get_microphones() ?? []) registerNode(node)
    for (const node of audio.get_streams() ?? []) registerNode(node)

    const audioSignals = [
      audio.connect("speaker-added", (...args: any[]) => registerNode(args[args.length - 1])),
      audio.connect("speaker-removed", (...args: any[]) => unregisterNode(args[args.length - 1])),
      audio.connect("microphone-added", (...args: any[]) => registerNode(args[args.length - 1])),
      audio.connect("microphone-removed", (...args: any[]) => unregisterNode(args[args.length - 1])),
      audio.connect("stream-added", (...args: any[]) => registerNode(args[args.length - 1])),
      audio.connect("stream-removed", (...args: any[]) => unregisterNode(args[args.length - 1])),
    ]
    signalCleanups.push(() => {
      for (const id of audioSignals) {
        try { audio.disconnect(id) } catch (_) {}
      }
      for (const node of [...watched.keys()]) unregisterNode(node)
      showDefaultMute = null
    })
  } catch (error) {
    dwarn("[OSD] WirePlumber monitoring failed:", error)
  }

  const cleanup = () => {
    if (stopped) return
    stopped = true
    if (animationId !== null) GLib.source_remove(animationId)
    for (const id of pollIds) GLib.source_remove(id)
    for (const disconnect of signalCleanups) {
      try { disconnect() } catch (_) {}
    }
    for (const card of [...cardsByKey.values()]) {
      if (card.hideTimer !== null) GLib.source_remove(card.hideTimer)
    }
    cardsByKey.clear()
    for (const view of views) {
      try { view.window.destroy() } catch (_) {}
    }
    flushDeviceVolumes()
  }
  app.connect("shutdown", cleanup)

  return views.map(view => view.window)
}
