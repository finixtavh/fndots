// Audio Mixer Menu
import app from "ags/gtk3/app"
import { Astal, Gdk, Gtk } from "ags/gtk3"
import GLib from "gi://GLib"
import AstalWp from "gi://AstalWp"
import { execAsync } from "ags/process"
import { iconImage, IC } from "../Helpers/Icons"
import { derr } from "../Helpers/DashLog"
import {
  markAudioUserVolume,
  markFlyoutAudioMute,
  markFlyoutAudioVolume,
  registerFlyout,
  trackEscapeDismiss,
} from "../Helpers/FlyoutState"
import {
  AudioNode,
  AudioSelectionKind,
  AudioSelectionGroup,
  audioGroupMuted,
  audioGroupVolume,
  audioSelectionSections,
  selectAudioGroup,
  selectedAudioGroup,
  subscribeAudioSelection,
} from "../Helpers/AudioSelection"

export type AudioMixerKind = AudioSelectionKind

interface ActiveAudioMenu {
  kind: AudioMixerKind
  close: () => void
}

let activeMenu: ActiveAudioMenu | null = null

function cls(widget: Gtk.Widget, name: string): void {
  widget.get_style_context().add_class(name)
}

function appIcon(iconName: string): Gtk.Image {
  const candidates = [
    iconName,
    iconName.replace(/\.desktop$/i, ""),
    "application-x-executable-symbolic",
  ].filter(Boolean)
  const theme = Gtk.IconTheme.get_default()
  const name = candidates.find(candidate => {
    try { return theme?.has_icon(candidate) } catch (_) { return false }
  }) ?? "application-x-executable-symbolic"

  return new Gtk.Image({
    icon_name: name,
    pixel_size: 16,
    visible: true,
  })
}

function makeMixerRow(
  wp: AstalWp.Wp,
  group: AudioSelectionGroup,
  kind: AudioMixerKind,
  radioGroup: Gtk.RadioButton | null,
): {
  row: Gtk.Widget
  radio: Gtk.RadioButton
  dispose: () => void
} {
  const row = new Gtk.EventBox({
    above_child: false,
    visible_window: true,
    visible: true,
  })
  cls(row, "audio-mixer-row")

  const content = new Gtk.Grid({
    column_spacing: 7,
    visible: true,
  })
  row.add(content)

  const name = new Gtk.Label({
    label: group.label,
    tooltip_text: group.label,
    xalign: 0,
    hexpand: true,
    visible: true,
  })
  name.set_ellipsize(3)
  name.set_max_width_chars(24)
  cls(name, "audio-mixer-name")

  const muteButton = new Gtk.Button({
    tooltip_text: group.label,
    valign: Gtk.Align.CENTER,
    visible: true,
  })
  cls(muteButton, "audio-mixer-icon-btn")
  muteButton.add(group.role === "application"
    ? appIcon(group.icon)
    : iconImage(group.role === "output" ? "vol" : "mic", IC.secondary, 16))

  const scale = Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL, 0, 100, 2)
  scale.set_draw_value(false)
  scale.set_hexpand(true)
  scale.set_size_request(185, -1)
  scale.set_increments(2, 10)
  scale.set_visible(true)
  cls(scale, "audio-mixer-scale")

  const percentage = new Gtk.Label({
    label: "0%",
    xalign: 1,
    valign: Gtk.Align.END,
    visible: true,
  })
  cls(percentage, "audio-mixer-percentage")

  const selectionRadio = new Gtk.RadioButton({
    tooltip_text: "Show in MainBar",
    valign: Gtk.Align.CENTER,
    visible: true,
  })
  if (radioGroup) selectionRadio.join_group(radioGroup)

  // Keep GTK's native radio indicator visible. The CSS only recolors/resizes
  // the circular indicator using the same palette as the Settings toggles.
  selectionRadio.set_mode(true)
  selectionRadio.set_relief(Gtk.ReliefStyle.NONE)
  cls(selectionRadio, "audio-mixer-selection")

  selectionRadio.get_accessible()?.set_name(`Show ${group.label} in MainBar`)

  const barColumn = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 1,
    hexpand: true,
    visible: true,
  })
  barColumn.add(name)
  barColumn.add(scale)

  content.attach(muteButton, 0, 0, 1, 1)
  content.attach(barColumn, 1, 0, 1, 1)
  content.attach(percentage, 2, 0, 1, 1)
  content.attach(selectionRadio, 3, 0, 1, 1)

  let syncing = false
  let syncingSelection = false
  let disposed = false
  let localVolume = Math.max(0, Math.min(1, audioGroupVolume(group.nodes)))
  let writeTimer: number | null = null
  let settleTimer: number | null = null
  let writeRunning = false
  let writeAgain = false

  const setVisualVolume = (volume: number) => {
    syncing = true
    localVolume = Math.max(0, Math.min(1, volume))
    scale.set_value(localVolume * 100)
    percentage.set_label(`${Math.round(localVolume * 100)}%`)
    syncing = false
  }

  const sync = () => {

    if (writeTimer === null && !writeRunning && settleTimer === null) {
      setVisualVolume(audioGroupVolume(group.nodes))
    }
    const muted = audioGroupMuted(group.nodes)
    const ctx = row.get_style_context()
    if (muted) ctx.add_class("muted")
    else ctx.remove_class("muted")
  }

  const sendLatestVolume = () => {
    if (disposed || writeRunning) return
    writeRunning = true
    writeAgain = false
    const sentVolume = localVolume
    const amount = `${(sentVolume * 100).toFixed(2)}%`

    Promise.all(group.nodes.map(node => {
      if (kind === "output") markAudioUserVolume(Number(node.id))
      else markFlyoutAudioVolume(Number(node.id), sentVolume)
      return execAsync(["wpctl", "set-volume", "-l", "1.0", String(node.id), amount])
    })).catch((e: any) => derr('[AudioMixerMenu]', e)).finally(() => {
      writeRunning = false
      if (disposed) return

      if (writeAgain || Math.abs(localVolume - sentVolume) >= 0.001) {
        writeAgain = false
        sendLatestVolume()
        return
      }

      settleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
        settleTimer = null
        sync()
        return GLib.SOURCE_REMOVE
      })
    })
  }

  const queueVolumeWrite = () => {
    if (disposed) return
    if (settleTimer !== null) {
      GLib.source_remove(settleTimer)
      settleTimer = null
    }
    if (writeRunning) {
      writeAgain = true
      return
    }
    if (writeTimer !== null) return

    writeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      writeTimer = null
      sendLatestVolume()
      return GLib.SOURCE_REMOVE
    })
  }

  scale.connect("value-changed", () => {
    if (syncing) return
    localVolume = Math.max(0, Math.min(100, scale.get_value())) / 100
    percentage.set_label(`${Math.round(localVolume * 100)}%`)
    queueVolumeWrite()
  })

  const scrollController = Gtk.EventControllerScroll.new(
    row,
    Gtk.EventControllerScrollFlags.VERTICAL,
  )
  scrollController.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
  scrollController.connect("scroll", (_controller: any, _dx: number, dy: number) => {
    if (!Number.isFinite(dy) || Math.abs(dy) < 0.001) return false
    const delta = dy < 0 ? 2 : -2
    scale.set_value(Math.max(0, Math.min(100, scale.get_value() + delta)))
    return true
  })

  muteButton.connect("clicked", () => {
    const mute = !audioGroupMuted(group.nodes)
    group.nodes.forEach(node => {
      try {
        const current = !!(node.get_mute?.() ?? node.mute)
        if (current === mute) return
        markFlyoutAudioMute(Number(node.id), mute)
        node.set_mute(mute)
      } catch (_) {}
    })
  })

  const syncSelection = () => {
    syncingSelection = true
    selectionRadio.set_active(selectedAudioGroup(wp, kind)?.key === group.key)
    syncingSelection = false
  }
  selectionRadio.connect("toggled", () => {
    if (syncingSelection || !selectionRadio.get_active()) return
    selectAudioGroup(kind, group.key)
  })
  const unsubscribeSelection = subscribeAudioSelection(changedKind => {
    if (changedKind === kind) syncSelection()
  })

  const subscriptions: Array<[AudioNode, number]> = []
  group.nodes.forEach(node => {
    subscriptions.push([node, node.connect("notify::volume", sync)])
    subscriptions.push([node, node.connect("notify::mute", sync)])
  })

  sync()
  syncSelection()
  return {
    row,
    radio: selectionRadio,
    dispose: () => {
      disposed = true
      if (writeTimer !== null) GLib.source_remove(writeTimer)
      if (settleTimer !== null) GLib.source_remove(settleTimer)
      subscriptions.forEach(([node, id]) => {
        try { node.disconnect(id) } catch (_) {}
      })
      unsubscribeSelection()
    },
  }
}

function openAudioMixerMenu(kind: AudioMixerKind, gdkmonitor: Gdk.Monitor): () => void {
  const wp = AstalWp.Wp.get_default()
  const { BOTTOM, RIGHT } = Astal.WindowAnchor

  let closed = false
  let rebuildTimer: number | null = null
  let rowDisposers: Array<() => void> = []

  const win = new (Astal.Window as any)({
    gdkmonitor,
    exclusivity: Astal.Exclusivity.IGNORE,
    layer: Astal.Layer.TOP,
    anchor: BOTTOM | RIGHT,
    margin_bottom: 50,
    margin_right: 7,
    keymode: Astal.Keymode.ON_DEMAND,
    application: app,
    namespace: "ags-audio-mixer",
  })
  const unregisterFlyout = registerFlyout()
  cls(win, "AudioMixerMenuWindow")

  const screen = win.get_screen()
  const visual = screen?.get_rgba_visual()
  if (visual) win.set_visual(visual)

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
    visible: true,
  })
  cls(root, "audio-mixer-root")

  win.add(root)

  const header = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 7,
    visible: true,
  })
  cls(header, "audio-mixer-header")
  header.add(iconImage(kind === "output" ? "vol" : "mic", IC.accent, 17))
  const title = new Gtk.Label({
    label: kind === "output" ? "Applications" : "Physical Inputs",
    xalign: 0,
    hexpand: true,
    visible: true,
  })
  cls(title, "audio-mixer-title")
  header.add(title)
  root.add(header)
  root.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const list = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
    visible: true,
  })
  cls(list, "audio-mixer-list")

  const scroll = new Gtk.ScrolledWindow({
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    visible: true,
  })
  scroll.set_min_content_height(40)
  scroll.set_max_content_height(280)
  scroll.set_propagate_natural_height(true)
  scroll.add(list)
  root.add(scroll)

  const rebuild = () => {
    if (closed) return
    rowDisposers.forEach(dispose => dispose())
    rowDisposers = []
    list.get_children().forEach(child => child.destroy())

    let radioGroup: Gtk.RadioButton | null = null
    const sections = audioSelectionSections(wp, kind)
    const groups = sections.flatMap(section => section.groups)
    sections.forEach((section, sectionIndex) => {
      if (sectionIndex > 0) {
        const sectionSeparator = new Gtk.Separator({
          orientation: Gtk.Orientation.HORIZONTAL,
          visible: true,
        })
        cls(sectionSeparator, "audio-mixer-section-separator")
        list.add(sectionSeparator)

        const sectionHeader = new Gtk.Box({
          spacing: 7,
          visible: true,
        })
        cls(sectionHeader, "audio-mixer-section-header")
        sectionHeader.add(iconImage(kind === "output" ? "vol" : "mic", IC.accent, 17))
        const sectionTitle = new Gtk.Label({
          label: section.title,
          xalign: 0,
          visible: true,
        })
        cls(sectionTitle, "audio-mixer-title")
        sectionHeader.add(sectionTitle)
        list.add(sectionHeader)
      }

      if (section.groups.length === 0) {
        const empty = new Gtk.Label({
          label: section.emptyLabel,
          visible: true,
        })
        cls(empty, "audio-mixer-empty")
        list.add(empty)
        return
      }

      section.groups.forEach((group, groupIndex) => {
        const item = makeMixerRow(wp, group, kind, radioGroup)
        if (!radioGroup) radioGroup = item.radio
        rowDisposers.push(item.dispose)
        list.add(item.row)
        if (groupIndex >= section.groups.length - 1) return
        const separator = new Gtk.Separator({
          orientation: Gtk.Orientation.HORIZONTAL,
          visible: true,
        })
        cls(separator, "audio-mixer-separator")
        list.add(separator)
      })
    })
    list.show_all()
    const [, naturalHeight] = list.get_preferred_height()
    const fallbackHeight = Math.max(40, groups.length * 34 + sections.length * 24)
    const contentHeight = naturalHeight > 0 ? naturalHeight : fallbackHeight
    scroll.set_min_content_height(Math.min(280, Math.max(40, contentHeight)))
    scroll.queue_resize()
    root.queue_resize()
    win.queue_resize()
  }

  const queueRebuild = () => {
    if (closed || rebuildTimer !== null) return
    rebuildTimer = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      rebuildTimer = null
      rebuild()
      return GLib.SOURCE_REMOVE
    })
  }

  const nodeSignals = [
    wp.connect("node-added", queueRebuild),
    wp.connect("node-removed", queueRebuild),
  ]

  let liveDataDisposed = false
  const disposeLiveData = () => {
    if (liveDataDisposed) return
    liveDataDisposed = true
    if (rebuildTimer !== null) {
      GLib.source_remove(rebuildTimer)
      rebuildTimer = null
    }
    rowDisposers.forEach(dispose => dispose())
    rowDisposers = []
    nodeSignals.forEach(id => {
      try { wp.disconnect(id) } catch (_) {}
    })
  }

  const close = () => {
    if (closed) return
    closed = true
    unregisterFlyout()
    if (activeMenu?.close === close) activeMenu = null
    disposeLiveData()
    try { win.destroy() } catch (_) {}
  }
  trackEscapeDismiss(win, close)

  win.connect("key-press-event", (_: any, event: any) => {
    const [, key] = event.get_keyval()
    if (key === Gdk.KEY_Escape) {
      close()
      return true
    }
    return false
  })
  win.connect("destroy", () => {
    closed = true
    unregisterFlyout()
    disposeLiveData()
    if (activeMenu?.close === close) activeMenu = null
  })

  rebuild()
  win.show_all()
  return close
}

export function toggleAudioMixerMenu(kind: AudioMixerKind, gdkmonitor: Gdk.Monitor): void {
  if (activeMenu?.kind === kind) {
    activeMenu.close()
    return
  }
  activeMenu?.close()
  const close = openAudioMixerMenu(kind, gdkmonitor)
  activeMenu = { kind, close }
}

export function closeAudioMixerMenu(): void {
  activeMenu?.close()
}

export function isAudioMixerMenuOpen(): boolean {
  return activeMenu !== null
}
