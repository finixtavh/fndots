// Bar
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import { derr, logFn } from "../Helpers/DashLog"
import { FN_DEBUG } from "../Helpers/FnLogCollector"
import GLib from "gi://GLib"
import { clampInterval } from "../Helpers/Perf"
import { scrollPercentDelta } from "../Helpers/Scroll"
import AstalTray from "gi://AstalTray"
import AstalHyprland from "gi://AstalHyprland"
import cairo from "gi://cairo"
import AstalWp from "gi://AstalWp"
import AstalBluetooth from "gi://AstalBluetooth"
import { IconImg, iconImage, setBatteryIcon, IC } from "../Helpers/Icons"
import { For, createBinding, createState, onCleanup } from "ags"
import { toggleNotifCenter, isDndEnabled, subscribeDnd } from "../Panels/NotificationCenter"
import { subscribeAppLauncherVisibility, toggleAppLauncher } from "../Panels/AppLauncher"
import { openWifiMenu } from "../Panels/WifiMenu"
import { openBluetoothMenu } from "../Panels/BluetoothMenu"
import { closeAudioMixerMenu, toggleAudioMixerMenu } from "../Panels/AudioMixerMenu"
import {
  AudioNode,
  AudioSelectionKind,
  audioGroupMuted,
  audioGroupVolume,
  selectedAudioGroup,
  subscribeAudioSelection,
} from "../Helpers/AudioSelection"
import { createPoll } from "ags/time"
import { execAsync } from "ags/process"
import { focusClient, focusWorkspace } from "../Helpers/HyprFocus"
import { registerFlyout, trackEscapeDismiss } from "../Helpers/FlyoutState"

const SANTIAGO_TZ = GLib.TimeZone.new("America/Santiago")

function Launcher() {
  const [open, setOpen] = createState(false)
  const unsubscribe = subscribeAppLauncherVisibility(setOpen)
  onCleanup(unsubscribe)

  return (
    <button
      class={open.as((visible: boolean) => visible ? 'launcher launcher-open' : 'launcher')}
      tooltip_text="Applications (SUPER)"
      onClicked={() => toggleAppLauncher()}
      $={(self: any) => self.get_accessible()?.set_name('Applications')}
    >
      {iconImage('launch', IC.accent, 16)}
    </button>
  )
}

function ColorPicker() {
  return (
    <button class="color-picker" tooltip_text="hyprpicker"
      onClicked={() => execAsync(['bash', '-c', 'pgrep -x hyprpicker >/dev/null 2>&1 || hyprpicker -a']).catch(() => {})}
    >
      {iconImage('dropper', IC.secondary, 15)}
    </button>
  )
}

function Clock() {
  const time = createPoll("--:--", 1000, () => {
    return GLib.DateTime.new_now(SANTIAGO_TZ)?.format("%H:%M") ?? "--:--"
  })
  return (
    <box class="clock" spacing={5}>
      {iconImage('clock', IC.accent, 14)}
      <label class="clock-time" label={time} />
    </box>
  )
}

function CalendarWidget({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const dateStr = createPoll("Fecha", 60_000, () => {
    return GLib.DateTime.new_now(SANTIAGO_TZ)?.format("%a %d %b") ?? "Fecha"
  })

  let calWin: any = null
  let unregisterCalendar: (() => void) | null = null
  onCleanup(() => {
    try { calWin?.destroy() } catch (_) {}
    unregisterCalendar?.()
    unregisterCalendar = null
    calWin = null
  })

  const toggleCal = () => {
    if (calWin) {
      try { calWin.destroy() } catch (_) {}
      unregisterCalendar?.()
      unregisterCalendar = null
      calWin = null
      return
    }
    const cal = new Gtk.Calendar({ visible: true })
    const box = new Gtk.Box({
      visible: true,
      margin_top: 8, margin_bottom: 8, margin_start: 8, margin_end: 8,
    })
    box.get_style_context().add_class('cal-popup-box')
    box.add(cal)

    calWin = new (Astal.Window as any)({
      gdkmonitor,
      exclusivity: Astal.Exclusivity.IGNORE,
      layer:       Astal.Layer.OVERLAY,
      anchor:      Astal.WindowAnchor.BOTTOM,
      margin_bottom: 50,
      keymode:     Astal.Keymode.ON_DEMAND,
      application: app,
    })
    unregisterCalendar = registerFlyout()
    calWin.get_style_context().add_class('CalendarPopup')
    ;(function() {
      const screen = calWin.get_screen()
      const visual = screen?.get_rgba_visual()
      if (visual) calWin.set_visual(visual)
    })()
    calWin.add(box)
    calWin.show_all()

    const currentWindow = calWin
    trackEscapeDismiss(currentWindow, () => {
      try { currentWindow.destroy() } catch (_) {}
      if (calWin === currentWindow) calWin = null
    })

    calWin.connect('key-press-event', (_: any, event: any) => {
      const [, k] = event.get_keyval()
      if (k === Gdk.KEY_Escape) {
        try { calWin?.destroy() } catch (_) {}
        calWin = null
      }
    })
    calWin.connect('destroy', () => {
      unregisterCalendar?.()
      unregisterCalendar = null
      calWin = null
    })
  }

  return (
    <button class="calendar-btn"
      tooltip_text="Click: mini calendar"
      onClicked={toggleCal}
    >
      <box class="calendar-box" spacing={6}>
        {iconImage('calendar', IC.dim, 14)}
        <label class="calendar-date" label={dateStr} />
      </box>
    </button>
  )
}

function AudioWidget({
  kind,
  gdkmonitor,
}: {
  kind: AudioSelectionKind
  gdkmonitor: Gdk.Monitor
}) {
  const wp = AstalWp.Wp.get_default()
  const [label, setLabel] = createState('100%')
  const [muted, setMuted] = createState(false)
  const [tip, setTip] = createState(kind === 'output' ? 'Output device' : 'Microphone')
  let nodes: AudioNode[] = []
  let nodeSignals: Array<[AudioNode, number]> = []
  let refreshId: number | null = null
  let disposed = false

  const update = () => {
    const isMuted = audioGroupMuted(nodes)
    const percentage = Math.round(Math.max(0, Math.min(1, audioGroupVolume(nodes))) * 100)
    setMuted(isMuted)
    setLabel(isMuted ? 'Mute' : `${percentage}%`)
  }

  const clearNodeSignals = () => {
    for (const [node, signalId] of nodeSignals) {
      try { node.disconnect(signalId) } catch (_) {}
    }
    nodeSignals = []
  }

  const refresh = () => {
    if (disposed) return
    clearNodeSignals()
    const selected = selectedAudioGroup(wp, kind)
    const fallback = kind === 'output'
      ? wp.get_default_speaker?.()
      : wp.get_default_microphone?.()
    nodes = selected?.nodes.length
      ? selected.nodes
      : (fallback ? [fallback as AudioNode] : [])
    const fallbackName = String(fallback?.description ?? fallback?.name
      ?? (kind === 'output' ? 'Output device' : 'Microphone'))
    setTip(selected?.label ?? fallbackName)
    for (const node of nodes) {
      nodeSignals.push([node, node.connect('notify::volume', update)])
      nodeSignals.push([node, node.connect('notify::mute', update)])
    }
    update()
  }

  const queueRefresh = () => {
    if (disposed || refreshId !== null) return
    refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      refreshId = null
      refresh()
      return GLib.SOURCE_REMOVE
    })
  }

  const wpSignals = [
    wp.connect('node-added', queueRefresh),
    wp.connect('node-removed', queueRefresh),
    wp.connect(kind === 'output' ? 'notify::default-speaker' : 'notify::default-microphone', queueRefresh),
  ]
  const unsubscribeSelection = subscribeAudioSelection(changedKind => {
    if (changedKind === kind) queueRefresh()
  })
  onCleanup(() => {
    disposed = true
    if (refreshId !== null) GLib.source_remove(refreshId)
    clearNodeSignals()
    unsubscribeSelection()
    for (const signalId of wpSignals) {
      try { wp.disconnect(signalId) } catch (_) {}
    }
  })
  refresh()

  const changeVolume = (increase: boolean) => {
    const targets = nodes.length > 0
      ? nodes.map(node => String(node.id))
      : [kind === 'output' ? '@DEFAULT_AUDIO_SINK@' : '@DEFAULT_AUDIO_SOURCE@']
    for (const target of targets) {
      execAsync([
        'wpctl', 'set-volume', '-l', '1.0', target,
        increase ? '2%+' : '2%-',
      ]).catch(() => {})
    }
  }

  return (
    <button
      class={muted.as((m: boolean) => m ? 'audio-btn muted' : 'audio-btn')}
      tooltip_text={tip}
      onClicked={() => toggleAudioMixerMenu(kind, gdkmonitor)}
      $={(self: any) => {
        self.add_events(
          Gdk.EventMask.SCROLL_MASK
          | Gdk.EventMask.SMOOTH_SCROLL_MASK
          | Gdk.EventMask.BUTTON_PRESS_MASK,
        )
        self.connect('button-press-event', (_: any, evt: any) => {
          const [, btn] = evt.get_button()
          if (btn === 3) {
            execAsync('pavucontrol').catch(() => {})
            return true
          }
          return false
        })
        self.connect('scroll-event', (_: any, evt: any) => {
          const delta = scrollPercentDelta(evt)
          if (delta === 0) return false
          changeVolume(delta > 0)
          return true
        })
      }}
    >
      <box spacing={4}>
        {IconImg(
          muted.as((m: boolean) => m
            ? (kind === 'output' ? 'vol-mute' : 'mic-mute')
            : (kind === 'output' ? 'vol' : 'mic')),
          muted.as((m: boolean) => m ? IC.red : IC.secondary),
          15,
        )}
        <label class="audio-vol"  label={label} />
      </box>
    </button>
  )
}

function VolumeWidget({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  return <AudioWidget kind="output" gdkmonitor={gdkmonitor} />
}

function MicWidget({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  return <AudioWidget kind="input" gdkmonitor={gdkmonitor} />
}

const _dec = new TextDecoder()

function getPrimaryIface(): string {
  try {
    const [ok, raw] = GLib.file_get_contents('/proc/net/route')
    if (!ok) return ''
    for (const line of _dec.decode(raw).split('\n').slice(1)) {
      const parts = line.trim().split('\t')
      if (parts.length > 1 && parts[1] === '00000000') return parts[0]
    }
  } catch (_) {}
  return ''
}

function isWirelessIface(iface: string): boolean {
  return GLib.file_test(`/sys/class/net/${iface}/wireless`, GLib.FileTest.IS_DIR)
}

function cleanNetworkName(value: string): string {
  const name = value.trim()
  if (!name || name === '--' || /^\(?none\)?$/i.test(name) || /not connected/i.test(name)) return ''
  return name.slice(0, 128)
}

async function queryWifiName(iface: string): Promise<string> {
  const probes: Array<{ argv: string[], parse: (output: string) => string }> = [
    {
      argv: ['timeout', '2s', 'iwctl', 'station', iface, 'show'],
      parse: output => output.match(/^\s*Connected network\s+(.+?)\s*$/m)?.[1] ?? '',
    },
  ]

  for (const probe of probes) {
    try {
      const raw = await execAsync(probe.argv)

      const output = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      const name = cleanNetworkName(probe.parse(output))
      if (name) return name
    } catch (_) {}
  }
  return ''
}

function NetworkWidget({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const iwdAvailable = GLib.find_program_in_path('iwctl') !== null
  const [netIcon,  setNetIcon]  = createState('wifi-off')
  const [netTip,   setNetTip]   = createState(
    iwdAvailable ? 'Wi-Fi disconnected' : 'Wi-Fi unavailable — install iwd',
  )

  let wifiMenuClose: (() => void) | null = null
  let alive = true
  let activeIface = ''
  let wifiName = ''
  let lookupGeneration = 0
  let lastLookupAt = 0

  const refreshWifiName = (iface: string) => {
    const now = Date.now()
    if (now - lastLookupAt < 15_000) return
    lastLookupAt = now
    const generation = ++lookupGeneration
    queryWifiName(iface).then(name => {
      if (!alive || generation !== lookupGeneration || getPrimaryIface() !== iface) return
      if (name) wifiName = name
      setNetTip(wifiName || 'Wi-Fi connected')
    }).catch(() => {})
  }

  const poll = () => {
    try {
      const iface = getPrimaryIface()
      if (iface !== activeIface) {
        activeIface = iface
        wifiName = ''
        lastLookupAt = 0
        lookupGeneration++
      }

      if (!iwdAvailable) {
        setNetIcon('wifi-off')
        setNetTip('Wi-Fi unavailable — install iwd')
      } else if (!iface) {
        setNetIcon('wifi-off')
        setNetTip('Wi-Fi disconnected')
      } else if (isWirelessIface(iface)) {
        setNetIcon('wifi')
        setNetTip(wifiName || 'Wi-Fi connected')
        refreshWifiName(iface)
      } else {
        setNetIcon('ethernet')
        setNetTip('Ethernet')
      }
    } catch (_) {}
  }

  const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(1500), () => { poll(); return GLib.SOURCE_CONTINUE })
  onCleanup(() => {
    alive = false
    lookupGeneration++
    GLib.source_remove(pollId)
    if (wifiMenuClose) { wifiMenuClose(); wifiMenuClose = null }
  })
  poll()

  return (
    <button class="sys-btn net-btn mainbar-tip-align" valign={Gtk.Align.CENTER}
      tooltip_text={netTip}
      sensitive={iwdAvailable}
      onClicked={() => {
        if (wifiMenuClose) { wifiMenuClose(); wifiMenuClose = null }
        else {
          const origClose = openWifiMenu(gdkmonitor)
          wifiMenuClose = () => { origClose(); wifiMenuClose = null }
        }
      }}
    >
      <box spacing={4} valign={Gtk.Align.CENTER}>
        {IconImg(netIcon, IC.secondary, 15)}
      </box>
    </button>
  )
}

function BluetoothWidget({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const [btIcon, setBtIcon] = createState('bt')
  const [btVis,  setBtVis]  = createState(false)
  const [btTip,  setBtTip]  = createState('Bluetooth off')
  let menuClose: (() => void) | null = null
  const unsubs: Array<() => void> = []
  let deviceUnsubs: Array<() => void> = []

  onCleanup(() => {
    deviceUnsubs.forEach(unsub => { try { unsub() } catch (_) {} })
    deviceUnsubs = []
    unsubs.forEach(unsub => { try { unsub() } catch (_) {} })
    if (menuClose) { menuClose(); menuClose = null }
  })

  try {
    const bluezAvailable = GLib.file_test('/usr/lib/bluetooth/bluetoothd', GLib.FileTest.IS_EXECUTABLE)
      || GLib.find_program_in_path('bluetoothd') !== null
    if (!bluezAvailable) return (<box />) as any
    const bt = (AstalBluetooth as any).Bluetooth?.get_default?.()
    if (!bt) return (<box />) as any

    const hasAdapter = () => {
      try {
        if (bt.adapter) return true
        const ads = bt.adapters ?? bt.get_adapters?.() ?? []
        return ads.length > 0
      } catch (_) { return false }
    }

    const update = () => {
      try {

        if (!hasAdapter()) {
          setBtVis(false)
          setBtTip('Bluetooth unavailable')
          return
        }
        const powered   = bt.isPowered ?? bt.is_powered ?? false
        const connected = bt.isConnected ?? bt.is_connected ?? false
        const devices = bt.devices ?? bt.get_devices?.() ?? []
        const names = [...new Set(
          devices
            .filter((device: any) => device.connected)
            .map((device: any) =>
              String(device.alias || device.name || device.address || '').trim())
            .filter(Boolean),
        )]
        setBtVis(true)
        setBtIcon(powered || connected ? 'bt' : 'bt-off')
        setBtTip(names.length > 0
          ? names.join(', ')
          : powered ? 'Bluetooth — no devices connected' : 'Bluetooth off')
      } catch (_) {}
    }

    const bindDeviceSignals = () => {
      deviceUnsubs.forEach(unsub => { try { unsub() } catch (_) {} })
      deviceUnsubs = []
      const devices = bt.devices ?? bt.get_devices?.() ?? []
      devices.forEach((device: any) => {
        ;['notify::connected', 'notify::alias', 'notify::name'].forEach(signal => {
          try {
            const id = device.connect(signal, update)
            deviceUnsubs.push(() => { try { device.disconnect(id) } catch (_) {} })
          } catch (_) {}
        })
      })
    }

    const refreshDevices = () => {
      bindDeviceSignals()
      update()
    }

    try { unsubs.push(createBinding(bt, 'isPowered').subscribe(update)) } catch (_) {}
    try { unsubs.push(createBinding(bt, 'isConnected').subscribe(update)) } catch (_) {}

    try { unsubs.push(createBinding(bt, 'adapter').subscribe(update)) } catch (_) {}
    try {
      const id = bt.connect('device-added', refreshDevices)
      unsubs.push(() => { try { bt.disconnect(id) } catch (_) {} })
    } catch (_) {}
    try {
      const id = bt.connect('device-removed', refreshDevices)
      unsubs.push(() => { try { bt.disconnect(id) } catch (_) {} })
    } catch (_) {}
    bindDeviceSignals()
    update()
  } catch (_) {
    return (<box />) as any
  }

  return (
    <button class="sys-btn mainbar-tip-align" valign={Gtk.Align.CENTER}
      visible={btVis}
      tooltip_text={btTip}
      onClicked={() => {
        if (menuClose) { menuClose(); menuClose = null }
        else {
          const origClose = openBluetoothMenu(gdkmonitor)
          menuClose = () => { origClose(); menuClose = null }
        }
      }}
    >
      {IconImg(btIcon, IC.secondary, 15)}
    </button>
  )
}

function BatteryWidget() {
  let batPath: string | null = null
  try {
    const dir = GLib.Dir.open('/sys/class/power_supply', 0)
    let entry: string | null
    while ((entry = dir.read_name()) !== null) {
      const candidate = `/sys/class/power_supply/${entry}`
      if (GLib.file_test(`${candidate}/capacity`, GLib.FileTest.EXISTS)
        && GLib.file_test(`${candidate}/status`, GLib.FileTest.EXISTS)) {
        batPath = candidate
        break
      }
    }
  } catch (_) {}

  if (!batPath) return (<box />) as any

  const [battText, setBattText] = createState('100%')
  const [tooltip,  setTooltip]  = createState('Battery')
  const battImg = new Gtk.Image({ visible: true })

  const readFile = (path: string): string => {
    try {
      const [ok, raw] = GLib.file_get_contents(path)
      return ok ? _dec.decode(raw).trim() : ''
    } catch (_) { return '' }
  }

  const update = () => {
    const pct    = parseInt(readFile(`${batPath}/capacity`)) || 0
    const status = readFile(`${batPath}/status`)
    const ch     = status === 'Charging'
    const full   = status === 'Full'
    const col = pct <= 15 ? IC.red : pct <= 30 ? IC.warn : IC.accent
    setBatteryIcon(battImg, pct, ch || full, col, 15)
    setBattText(`${pct}%`)
    setTooltip(ch ? `Battery: ${pct}% (Charging)` : full ? 'Battery: Full' : `Battery: ${pct}%`)
  }

  update()
  const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(30_000), () => { update(); return GLib.SOURCE_CONTINUE })
  onCleanup(() => GLib.source_remove(pollId))

  return (
    <button class="sys-btn battery-btn" valign={Gtk.Align.CENTER} tooltip_text={tooltip}>
      <box spacing={3}>
        {battImg}
        <label class="batt-pct" label={battText} />
      </box>
    </button>
  )
}

function VpnWidget() {
  const VPN_IFACE = /^(?:tun|tap|wg|ppp|vpn|tailscale)\d*$/
  let button: Gtk.Button | null = null
  let active = false
  let generation = 0
  let alive = true

  const routeDevice = (route: string): string => {
    const match = route.match(/(?:^|\s)dev\s+(\S+)/)
    return match?.[1] ?? ''
  }

  const apply = (next: boolean, trigger: string, details: string) => {
    const changed = next !== active
    active = next
    button?.set_visible(next)

    if (FN_DEBUG && changed) {
      logFn(
        'AGS',
        'debug',
        `Status icon VPN ${next ? 'ON' : 'OFF'}`,
        `trigger=${trigger} | ${details}`,
      )
    }
  }

  const check = async () => {
    const current = ++generation

    try {
      const calls: Promise<string>[] = [
        execAsync(['ip', 'route', 'get', '1.1.1.1']).catch(() => ''),
        execAsync(['ip', '-6', 'route', 'get', '2606:4700:4700::1111']).catch(() => ''),
      ]

      const nmcli = GLib.find_program_in_path('nmcli')
      if (nmcli) {
        calls.push(
          execAsync([nmcli, '-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active'])
            .catch(() => ''),
        )
      }

      const results = await Promise.all(calls)
      if (!alive || current !== generation) return

      const ipv4Dev = routeDevice(results[0] ?? '')
      const ipv6Dev = routeDevice(results[1] ?? '')
      const nm = nmcli ? (results[2] ?? '') : ''

      const ipv4Vpn = VPN_IFACE.test(ipv4Dev)
      const ipv6Vpn = VPN_IFACE.test(ipv6Dev)
      const nmVpn = nm.split('\n').some(line => {
        const fields = line.trim().split(':')
        return fields[1]?.toLowerCase() === 'vpn'
      })

      const next = ipv4Vpn || ipv6Vpn || nmVpn
      const trigger = ipv4Vpn
        ? 'ipv4-route'
        : ipv6Vpn
          ? 'ipv6-route'
          : nmVpn
            ? 'networkmanager'
            : 'none'

      apply(
        next,
        trigger,
        `ipv4.dev=${ipv4Dev || '-'} | ipv6.dev=${ipv6Dev || '-'} | nmcli.vpn=${nmVpn}`,
      )
    } catch (e) {
      if (!alive || current !== generation) return
      apply(false, 'error', String(e))
    }
  }

  const widget = (
    <button
      class="sys-btn vpn-btn"
      valign={Gtk.Align.CENTER}
      tooltip_text="VPN Active"
      $={(self: any) => {
        button = self
        self.set_no_show_all(true)
        self.set_visible(false)
      }}
    >
      {iconImage('vpn', IC.accent, 15)}
    </button>
  ) as Gtk.Button

  const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(4000), () => {
    void check()
    return GLib.SOURCE_CONTINUE
  })

  onCleanup(() => {
    alive = false
    generation++
    GLib.source_remove(pollId)
  })

  void check()

  return widget
}

const CIRCLED_DIGITS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
const circledNum = (id: number) => CIRCLED_DIGITS[id - 1] ?? `${id}`

function WorkspacesWidget() {
  const hypr = AstalHyprland.get_default()
  const [activeId, setActiveId] = createState(1)
  const [extraIds, setExtraIds] = createState<number[]>([])

  const update = () => {
    try {
      const focused = (hypr as any).focusedWorkspace?.id ?? 1
      setActiveId(focused)

      const wsList: any[] = (hypr as any).workspaces ?? []
      const extras = wsList
        .filter(w => w.id > 5 && (w.id === focused || (w.clients?.length ?? 0) > 0))
        .map(w => w.id as number)
        .sort((a, b) => a - b)
      setExtraIds(extras)
    } catch (_) {}
  }

  const unsubs: Array<() => void> = []
  try { unsubs.push(createBinding(hypr, 'focusedWorkspace').subscribe(update)) } catch (_) {}
  try { unsubs.push(createBinding(hypr, 'workspaces').subscribe(update)) } catch (_) {}
  onCleanup(() => unsubs.forEach(unsub => { try { unsub() } catch (_) {} }))
  update()

  return (
    <box class="workspaces" spacing={4} valign={Gtk.Align.CENTER}>
      {[1, 2, 3, 4, 5].map(id => (
        <button
          class={activeId.as((a: number) => a === id ? 'ws-dot active' : 'ws-dot')}
          onClicked={() => { focusWorkspace(id).catch(() => {}) }}
          tooltip_text={`Workspace ${id}`}
        >
          <label label="•" />
        </button>
      ))}
      <For each={extraIds}>
        {(id: number) => (
          <button
            class={activeId.as((a: number) => a === id ? 'ws-dot ws-dot-extra active' : 'ws-dot ws-dot-extra')}
            onClicked={() => { focusWorkspace(id).catch(() => {}) }}
            tooltip_text={`Workspace ${id}`}
          >
            <label class="ws-extra-num" label={circledNum(id)} />
          </button>
        )}
      </For>
    </box>
  )
}

interface BarFlyoutHandle {
  close: () => void
  closeInstant: () => void
}

type SysmonFlyoutOwner = "cpu" | "ram"

let activeSysmonFlyout: {
  owner: SysmonFlyoutOwner
  handle: BarFlyoutHandle
} | null = null

function openBarFlyout(gdkmonitor: Gdk.Monitor, content: Gtk.Widget, marginRight = 10): BarFlyoutHandle {
  let closed = false
  let destroyTimer = 0
  const { BOTTOM, RIGHT } = Astal.WindowAnchor
  const fw = new (Astal.Window as any)({
    gdkmonitor,
    exclusivity: Astal.Exclusivity.NORMAL,
    layer: Astal.Layer.TOP,
    anchor: BOTTOM | RIGHT,
    margin_right: marginRight,
    keymode: Astal.Keymode.NONE,
    application: app,
    namespace: "ags-system-flyout",
  }) as Astal.Window

  const unregisterFlyout = registerFlyout()
  fw.get_style_context().add_class("BarFlyoutWindow")

  const visual = fw.get_screen()?.get_rgba_visual()
  if (visual) fw.set_visual(visual)

  fw.add(content)
  fw.show_all()

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    try {
      const [, natW] = (content as any).get_preferred_width()
      if (natW > 0) fw.set_size_request(natW, -1)
    } catch (_) {}
    return GLib.SOURCE_REMOVE
  })

  const close = () => {
    if (closed) return
    closed = true
    unregisterFlyout()
    try { fw.destroy() } catch (_) {}
  }

  const closeInstant = () => {
    if (closed) return
    closed = true
    unregisterFlyout()

    try {
      fw.set_opacity(0)
      fw.queue_draw()
    } catch (_) {}

    destroyTimer = GLib.timeout_add(GLib.PRIORITY_HIGH, 20, () => {
      destroyTimer = 0
      try { fw.destroy() } catch (_) {}
      return GLib.SOURCE_REMOVE
    })
  }

  fw.connect('destroy', () => {
    if (destroyTimer) {
      GLib.source_remove(destroyTimer)
      destroyTimer = 0
    }
    unregisterFlyout()
  })

  return { close, closeInstant }
}

interface GaugeSeg { frac: number; r: number; g: number; b: number }

const _toRad    = (d: number) => (d * Math.PI) / 180
const _GSTART   = _toRad(150)
const _GSWEEP   = _toRad(240)

function _textCenter(cr: any, text: string, cx: number, cy: number, fs: number) {
  cr.setFontSize(fs)
  try {
    const te = cr.textExtents(text)
    const xb = Array.isArray(te) ? (te[0] ?? 0) : (te.xBearing ?? te.x_bearing ?? 0)
    const yb = Array.isArray(te) ? (te[1] ?? 0) : (te.yBearing ?? te.y_bearing ?? 0)
    const tw = Array.isArray(te) ? (te[2] ?? 0) : (te.width ?? 0)
    const th = Array.isArray(te) ? (te[3] ?? 0) : (te.height ?? 0)
    cr.moveTo(cx - xb - tw / 2, cy - yb - th / 2)
  } catch (_) {
    cr.moveTo(cx - text.length * fs * 0.3, cy + fs * 0.35)
  }
  cr.showText(text)
}

function drawRadialGauge(
  cr: any, w: number, h: number,
  value: number, pctText: string, subText: string,
  colR: number, colG: number, colB: number
) {
  const cx = w / 2, cy = h / 2
  const r  = Math.min(w, h) * 0.36
  const lw = Math.max(4, r * 0.16)
  cr.setLineWidth(lw)
  try { cr.setLineCap(1) } catch (_) {}

  cr.setSourceRGBA(colR, colG, colB, 0.13)
  cr.arc(cx, cy, r, _GSTART, _GSTART + _GSWEEP)
  cr.stroke()

  if (value > 0.005) {
    cr.setSourceRGB(colR, colG, colB)
    cr.arc(cx, cy, r, _GSTART, _GSTART + _GSWEEP * Math.min(1, value))
    cr.stroke()
  }

  cr.setSourceRGB(0.91, 0.91, 0.91)
  _textCenter(cr, pctText, cx, cy, Math.max(8, r * 0.34))
  cr.setSourceRGB(0.45, 0.45, 0.45)
  _textCenter(cr, subText, cx, cy + r * 0.58, Math.max(6, r * 0.22))
}

function drawSegmentedGauge(
  cr: any, w: number, h: number,
  segs: GaugeSeg[], centerText: string, subText: string
) {
  const cx = w / 2, cy = h / 2
  const r  = Math.min(w, h) * 0.36
  const lw = Math.max(4, r * 0.16)
  cr.setLineWidth(lw)
  try { cr.setLineCap(1) } catch (_) {}

  cr.setSourceRGBA(0.13, 0.13, 0.13, 0.9)
  cr.arc(cx, cy, r, _GSTART, _GSTART + _GSWEEP)
  cr.stroke()

  let angle = _GSTART, remaining = 1.0
  for (const s of segs) {
    const frac = Math.min(Math.max(0, s.frac), remaining)
    remaining -= frac
    const sw = _GSWEEP * frac
    if (sw < 0.001) continue
    cr.setSourceRGB(s.r, s.g, s.b)
    cr.arc(cx, cy, r, angle, angle + sw)
    cr.stroke()
    angle += sw
  }

  cr.setSourceRGB(0.91, 0.91, 0.91)
  _textCenter(cr, centerText, cx, cy, Math.max(8, r * 0.32))
  cr.setSourceRGB(0.45, 0.45, 0.45)
  _textCenter(cr, subText, cx, cy + r * 0.58, Math.max(6, r * 0.20))
}

interface GpuInfo { name: string; usedMB: number; totalMB: number; utilPct: number; ok: boolean }
function readGpu(): GpuInfo {

  try {
    const drm = GLib.Dir.open('/sys/class/drm', 0)
    let entry: string | null
    while ((entry = drm.read_name()) !== null) {
      if (!/^card\d+$/.test(entry)) continue
      const base = `/sys/class/drm/${entry}/device`
      if (!GLib.file_test(`${base}/gpu_busy_percent`, GLib.FileTest.EXISTS)) continue
      try {
        const [busyOk, busyRaw] = GLib.file_get_contents(`${base}/gpu_busy_percent`)
        if (!busyOk) continue
        const util = parseInt(_dec.decode(busyRaw).trim()) || 0
        let usedMB = 0
        let totalMB = 0
        try {
          const [usedOk, usedRaw] = GLib.file_get_contents(`${base}/mem_info_vram_used`)
          const [totalOk, totalRaw] = GLib.file_get_contents(`${base}/mem_info_vram_total`)
          if (usedOk && totalOk) {
            usedMB = Math.round(parseInt(_dec.decode(usedRaw).trim()) / (1024 * 1024))
            totalMB = Math.round(parseInt(_dec.decode(totalRaw).trim()) / (1024 * 1024))
          }
        } catch (_) {}

        let vendor = ''
        try {
          const [vendorOk, vendorRaw] = GLib.file_get_contents(`${base}/vendor`)
          if (vendorOk) vendor = _dec.decode(vendorRaw).trim().toLowerCase()
        } catch (_) {}
        let name = vendor === '0x8086' ? 'Intel GPU'
          : vendor === '0x1002' ? 'AMD GPU'
          : vendor === '0x10de' ? 'NVIDIA GPU'
          : 'DRM GPU'
        try {
          const [nameOk, nameRaw] = GLib.file_get_contents(`${base}/product_name`)
          if (nameOk) name = _dec.decode(nameRaw).trim().replace(/.*\[/, '').replace(']', '').trim() || name
        } catch (_) {}
        return { name, usedMB, totalMB, utilPct: util, ok: true }
      } catch (_) { continue }
    }
  } catch (_) {}

  try {
    if (GLib.find_program_in_path('nvidia-smi')) {
      const [b, out] = GLib.spawn_command_line_sync(
        'nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits'
      )
      if (b && out) {
        const parts = _dec.decode(out).trim().split(', ')
        if (parts.length >= 4) {
          return {
            name:     parts[0].replace('NVIDIA GeForce ', '').replace('NVIDIA ', '').trim(),
            usedMB:   parseInt(parts[1]) || 0,
            totalMB:  parseInt(parts[2]) || 0,
            utilPct:  parseInt(parts[3]) || 0,
            ok: true,
          }
        }
      }
    }
  } catch (_) {}
  return { name: 'No GPU', usedMB: 0, totalMB: 0, utilPct: 0, ok: false }
}

function buildSystemFlyoutHeader(iconName: string, title: string): Gtk.Box {
  const header = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    visible: true,
  })
  header.get_style_context().add_class('bar-flyout-header')
  header.add(iconImage(iconName, IC.accent, 17))

  const label = new Gtk.Label({ label: title, visible: true, xalign: 0 })
  label.get_style_context().add_class('bar-flyout-title')
  header.add(label)
  return header
}

function buildCpuFlyout(): Gtk.Widget {

  let prevIdle = 0, prevTotal = 0
  const readCpuPct = (): number => {
    try {
      const [ok, raw] = GLib.file_get_contents('/proc/stat')
      if (!ok) return 0
      const parts = _dec.decode(raw).split('\n')[0].split(/\s+/).slice(1).map(Number)
      const idle  = parts[3] + (parts[4] ?? 0)
      const total = parts.reduce((a: number, b: number) => a + b, 0)
      const dI = idle - prevIdle, dT = total - prevTotal
      prevIdle = idle; prevTotal = total
      return dT > 0 ? Math.round((1 - dI / dT) * 100) : 0
    } catch (_) { return 0 }
  }
  readCpuPct()

  const readCpuName = (): string => {
    try {
      const [ok, raw] = GLib.file_get_contents('/proc/cpuinfo')
      if (!ok) return 'CPU'
      for (const line of _dec.decode(raw).split('\n')) {
        const m = line.match(/^model name\s*:\s*(.+)/)
        if (!m) continue
        const n = m[1].trim()
        const r = n.match(/\b(Ryzen\s+\d+\s+\d+\w*|Ryzen\s+\w+|Core\s+[im]\d+|i[3579]-\d+\w*|Xeon\s+\w+|EPYC\s+\w+)/)
        return r ? r[0] : n.replace(/\s*@.*$/, '').trim().slice(0, 18)
      }
    } catch (_) {}
    return 'CPU'
  }
  const cpuName = readCpuName()

  let prevDotJiffies = 0, prevCpuTotal = 0
  const readDotfilesCpuPct = (): number => {
    let procJiffies = 0
    try {
      const dir = GLib.Dir.open('/proc', 0)
      let fn = dir.read_name()
      while (fn) {
        if (/^\d+$/.test(fn)) {
          try {
            const [ok, raw] = GLib.file_get_contents(`/proc/${fn}/stat`)
            if (ok) {
              const s    = _dec.decode(raw)
              const rp   = s.lastIndexOf(')')
              const comm = s.slice(s.indexOf('(') + 1, rp)
              if (DOTFILES_CPU_PROC_NAMES.has(comm)) {
                const rest = s.slice(rp + 2).split(' ')
                procJiffies += (parseInt(rest[11]) || 0) + (parseInt(rest[12]) || 0)
              }
            }
          } catch (_) {}
        }
        fn = dir.read_name()
      }
    } catch (_) {}
    let cpuTotal = 0
    try {
      const [ok, raw] = GLib.file_get_contents('/proc/stat')
      if (ok) cpuTotal = _dec.decode(raw).split('\n')[0].split(/\s+/).slice(1).map(Number).reduce((a: number, b: number) => a + b, 0)
    } catch (_) {}
    const dProc = procJiffies - prevDotJiffies
    const dTot  = cpuTotal   - prevCpuTotal
    prevDotJiffies = procJiffies; prevCpuTotal = cpuTotal
    return dTot > 0 ? Math.max(0, Math.round((dProc / dTot) * 100)) : 0
  }
  readDotfilesCpuPct()

  const GSIZE = 130
  let cpuPct  = 0
  let gpuData: GpuInfo = { name: '…', usedMB: 0, totalMB: 0, utilPct: 0, ok: false }

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
    visible: true,
  })
  root.get_style_context().add_class('bar-flyout-root')

  root.add(buildSystemFlyoutHeader('cpu', 'System'))
  root.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const body = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, visible: true })
  body.get_style_context().add_class('bar-flyout-body')
  body.set_halign(Gtk.Align.CENTER)
  root.add(body)

  const cpuSec = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
    visible: true,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.START,
  })
  cpuSec.get_style_context().add_class('system-meter-section')
  const cpuSubHdr = new Gtk.Label({ label: 'CPU', visible: true, xalign: 0.5 })
  cpuSubHdr.get_style_context().add_class('bar-flyout-sub-title')
  cpuSec.add(cpuSubHdr)

  const cpuDa = new Gtk.DrawingArea({ visible: true, halign: Gtk.Align.CENTER })
  cpuDa.set_size_request(GSIZE, GSIZE)
  cpuDa.connect('draw', (_w: any, cr: any) => {
    drawRadialGauge(cr, GSIZE, GSIZE, cpuPct / 100, `${cpuPct}%`, cpuName.slice(0, 14),
      0x89/255, 0xB1/255, 0x9E/255)
    return false
  })
  cpuSec.add(cpuDa)

  const cpuCaptionLbl = new Gtk.Label({ label: `${cpuName} · Dotfiles -`, visible: true, xalign: 0.5 })
  cpuCaptionLbl.get_style_context().add_class('gauge-caption')
  cpuCaptionLbl.set_max_width_chars(28)
  cpuCaptionLbl.set_ellipsize(3)
  cpuSec.add(cpuCaptionLbl)

  const gpuSec = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
    visible: true,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.START,
  })
  gpuSec.get_style_context().add_class('system-meter-section')
  const gpuSubHdr = new Gtk.Label({ label: 'GPU', visible: true, xalign: 0.5 })
  gpuSubHdr.get_style_context().add_class('bar-flyout-sub-title')
  gpuSec.add(gpuSubHdr)

  const gpuDa = new Gtk.DrawingArea({ visible: true, halign: Gtk.Align.CENTER })
  gpuDa.set_size_request(GSIZE, GSIZE)
  gpuDa.connect('draw', (_w: any, cr: any) => {
    const d = gpuData
    if (!d.ok) {
      drawRadialGauge(cr, GSIZE, GSIZE, 0, 'N/A', 'No GPU', 0.4, 0.4, 0.4)
    } else {
      drawRadialGauge(cr, GSIZE, GSIZE, d.utilPct / 100,
        `${d.utilPct}%`, d.name.slice(0, 14),
        0.94, 0.64, 0.20)
    }
    return false
  })
  gpuSec.add(gpuDa)

  const gpuNameLbl = new Gtk.Label({ label: '-', visible: true, xalign: 0.5 })
  gpuNameLbl.get_style_context().add_class('gauge-caption')
  gpuNameLbl.set_max_width_chars(28); gpuNameLbl.set_ellipsize(3)
  gpuSec.add(gpuNameLbl)

  body.add(cpuSec)
  body.add(new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL, visible: true }))
  body.add(gpuSec)

  const update = () => {
    cpuPct  = readCpuPct()
    gpuData = readGpu()
    cpuDa.queue_draw()
    gpuDa.queue_draw()
    cpuCaptionLbl.set_label(`${cpuName} · Dotfiles ${readDotfilesCpuPct()}%`)
    gpuNameLbl.set_label(gpuData.ok ? gpuData.name : 'No compatible source')
  }

  update()

  let alive = true
  const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(2000), () => {
    if (!alive) return GLib.SOURCE_REMOVE
    update(); return GLib.SOURCE_CONTINUE
  })
  root.connect('destroy', () => { alive = false; GLib.source_remove(pollId) })
  return root
}

const DOTFILES_CPU_PROC_NAMES = new Set([
  'gjs',
  'cava',
  'awww-daemon',
  'mpvpaper',
])

const DOTFILES_RAM_PROC_NAMES = new Set([
  ...DOTFILES_CPU_PROC_NAMES,
  'chroma',
  'fnnetspeed',
  'ditto',
])

function readActiveDotfilesProcessRamKB(pid: string): number {
  const statusPath = `/proc/${pid}/status`
  if (!GLib.file_test(statusPath, GLib.FileTest.IS_REGULAR)) return 0

  try {
    const [ok, raw] = GLib.file_get_contents(statusPath)
    if (!ok) return 0

    const text = _dec.decode(raw)
    const name = text.match(/^Name:\s+(\S+)/m)?.[1]
    if (!name || !DOTFILES_RAM_PROC_NAMES.has(name)) return 0

    const state = text.match(/^State:\s+([A-Z])/m)?.[1]
    if (!state || state === 'Z' || state === 'X') return 0

    const rss = text.match(/^VmRSS:\s+(\d+)/m)?.[1]
    return rss ? Number.parseInt(rss, 10) || 0 : 0
  } catch (_) {
    return 0
  }
}

function readDotfilesRamKB(): number {
  let totalKB = 0
  try {
    const d = GLib.Dir.open('/proc', 0)
    let fn = d.read_name()
    while (fn) {
      if (/^\d+$/.test(fn)) totalKB += readActiveDotfilesProcessRamKB(fn)
      fn = d.read_name()
    }
  } catch (_) {}
  return totalKB
}

function buildRamFlyout(): Gtk.Widget {
  const COL_USED:  [number, number, number] = [0.94, 0.42, 0.55]
  const COL_CACHE: [number, number, number] = [0x89/255, 0xB1/255, 0x9E/255]
  const COL_FREE:  [number, number, number] = [0.25, 0.40, 0.32]
  const GSIZE = 130

  const readMem = () => {
    try {
      const [ok, raw] = GLib.file_get_contents('/proc/meminfo')
      if (!ok) return null
      const m: Record<string, number> = {}
      for (const line of _dec.decode(raw).split('\n')) {
        const p = line.match(/^(\w+):\s+(\d+)/)
        if (p) m[p[1]] = parseInt(p[2], 10)
      }
      const total = m['MemTotal'] ?? 0, free = m['MemFree'] ?? 0
      const avail = m['MemAvailable'] ?? 0
      const swapTotal = m['SwapTotal'] ?? 0, swapFree = m['SwapFree'] ?? 0
      return {
        total, free,
        used:        Math.max(0, total - avail),
        reclaimable: Math.max(0, avail - free),
        swapTotal, swapFree,
      }
    } catch (_) { return null }
  }

  const fmtKB = (kb: number) => {
    const gb = kb / (1024 * 1024)
    return gb >= 1 ? `${gb.toFixed(1)}G` : `${Math.round(kb / 1024)}M`
  }

  const root = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 0,
    visible: true,
  })
  root.get_style_context().add_class('bar-flyout-root')

  root.add(buildSystemFlyoutHeader('ram', 'Memory'))
  root.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const body = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, visible: true })
  body.get_style_context().add_class('bar-flyout-body')
  root.add(body)

  const mkSection = (title: string) => {
    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL, spacing: 4, visible: true,
      halign: Gtk.Align.CENTER,
    })
    box.get_style_context().add_class('system-meter-section')
    const sh = new Gtk.Label({ label: title, visible: true, xalign: 0.5, halign: Gtk.Align.CENTER })
    sh.get_style_context().add_class('bar-flyout-sub-title')
    box.add(sh)
    const da = new Gtk.DrawingArea({ visible: true, halign: Gtk.Align.CENTER })
    da.set_size_request(GSIZE, GSIZE)
    box.add(da)
    const legend = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL, spacing: 2, visible: true,
      halign: Gtk.Align.FILL,
      hexpand: true,
    })
    legend.get_style_context().add_class('gauge-legend')
    box.add(legend)
    return { box, da, legend }
  }

  const mkRow = (parent: Gtk.Box, name: string, cr: number, cg: number, cb: number): Gtk.Label => {
    const hex = `#${Math.round(cr*255).toString(16).padStart(2,'0')}${Math.round(cg*255).toString(16).padStart(2,'0')}${Math.round(cb*255).toString(16).padStart(2,'0')}`
    const row = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, visible: true,
      halign: Gtk.Align.FILL,
      hexpand: true,
    })
    row.get_style_context().add_class('gauge-legend-row')
    const dot = new Gtk.Label({ visible: true })
    dot.set_use_markup(true)
    dot.set_markup(`<span foreground="${hex}">●</span>`)
    dot.get_style_context().add_class('gauge-legend-dot')
    row.pack_start(dot, false, false, 0)
    const nameLabel = new Gtk.Label({ label: name, visible: true, xalign: 0, hexpand: true })
    nameLabel.get_style_context().add_class('gauge-legend-name')
    row.pack_start(nameLabel, true, true, 0)
    const valueLabel = new Gtk.Label({ label: '-', visible: true, xalign: 1 })
    valueLabel.get_style_context().add_class('gauge-legend-value')
    row.pack_end(valueLabel, false, false, 0)
    parent.add(row)
    return valueLabel
  }

  const ram  = mkSection('RAM')
  const sep  = new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL, visible: true })
  const swap = mkSection('Swap')

  body.add(ram.box)
  body.add(sep)
  body.add(swap.box)

  const ramUsedLbl  = mkRow(ram.legend, 'Used', ...COL_USED)
  const ramCacheLbl = mkRow(ram.legend, 'Cache', ...COL_CACHE)
  const ramFreeLbl  = mkRow(ram.legend, 'Free', ...COL_FREE)
  ram.legend.add(new Gtk.Separator({
    orientation: Gtk.Orientation.HORIZONTAL, visible: true,
    margin_top: 4, margin_bottom: 2,
  }))
  const COL_DOTFILES: [number, number, number] = [0.55, 0.55, 0.55]
  const ramDotfilesLbl = mkRow(ram.legend, 'Dotfiles', ...COL_DOTFILES)
  const swapUsedLbl = mkRow(swap.legend, 'Used', ...COL_USED)
  const swapFreeLbl = mkRow(swap.legend, 'Free', ...COL_FREE)

  let memData: ReturnType<typeof readMem> = null

  const update = () => {
    const d = readMem()
    memData = d
    if (!d) return
    const swapUsed = d.swapTotal - d.swapFree
    ramUsedLbl.set_label(fmtKB(d.used))
    ramCacheLbl.set_label(fmtKB(d.reclaimable))
    ramFreeLbl.set_label(fmtKB(d.free))
    ramDotfilesLbl.set_label(fmtKB(readDotfilesRamKB()))
    swapUsedLbl.set_label(fmtKB(swapUsed))
    swapFreeLbl.set_label(fmtKB(d.swapFree))
    swap.box.set_visible(d.swapTotal > 0)
    sep.set_visible(d.swapTotal > 0)
    ram.da.queue_draw()
    swap.da.queue_draw()
  }

  ram.da.connect('draw', (_w: any, cr: any) => {
    const d = memData
    if (!d) return false
    const usedF  = d.total > 0 ? d.used / d.total : 0
    const cacheF = d.total > 0 ? d.reclaimable / d.total : 0
    const freeF  = d.total > 0 ? d.free / d.total : 0
    const totalG = d.total > 0 ? (d.total / (1024 * 1024)).toFixed(1) : '?'
    drawSegmentedGauge(cr, GSIZE, GSIZE, [
      { frac: usedF,  r: COL_USED[0],  g: COL_USED[1],  b: COL_USED[2]  },
      { frac: cacheF, r: COL_CACHE[0], g: COL_CACHE[1], b: COL_CACHE[2] },
      { frac: freeF,  r: COL_FREE[0],  g: COL_FREE[1],  b: COL_FREE[2]  },
    ], `${Math.round(usedF * 100)}%`, `of ${totalG}G`)
    return false
  })

  swap.da.connect('draw', (_w: any, cr: any) => {
    const d = memData
    if (!d) return false
    const swapUsed = d.swapTotal - d.swapFree
    const usedF = d.swapTotal > 0 ? swapUsed / d.swapTotal : 0
    const freeF = d.swapTotal > 0 ? d.swapFree / d.swapTotal : 0
    const totalG = d.swapTotal > 0 ? (d.swapTotal / (1024 * 1024)).toFixed(1) : '?'
    drawSegmentedGauge(cr, GSIZE, GSIZE, [
      { frac: usedF, r: COL_USED[0], g: COL_USED[1], b: COL_USED[2] },
      { frac: freeF, r: COL_FREE[0], g: COL_FREE[1], b: COL_FREE[2] },
    ], `${Math.round(usedF * 100)}%`, `of ${totalG}G`)
    return false
  })

  update()

  let alive = true
  const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(2000), () => {
    if (!alive) return GLib.SOURCE_REMOVE
    update(); return GLib.SOURCE_CONTINUE
  })
  root.connect('destroy', () => { alive = false; GLib.source_remove(pollId) })
  return root
}

function CpuWidget({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const [cpuStr, setCpuStr] = createState('-')
  let prevIdle = 0, prevTotal = 0

  const readOverall = (): number => {
    try {
      const [ok, raw] = GLib.file_get_contents('/proc/stat')
      if (!ok) return 0
      const line  = _dec.decode(raw).split('\n')[0]
      const parts = line.split(/\s+/).slice(1).map(Number)
      const idle  = parts[3] + (parts[4] ?? 0)
      const total = parts.reduce((a: number, b: number) => a + b, 0)
      const dIdle = idle - prevIdle, dTotal = total - prevTotal
      prevIdle = idle; prevTotal = total
      return dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 100) : 0
    } catch (_) { return 0 }
  }

  const update = () => setCpuStr(`${readOverall()}%`)
  update()
  const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(3000), () => { update(); return GLib.SOURCE_CONTINUE })
  onCleanup(() => GLib.source_remove(pollId))

  return (
    <button class="sys-btn sysmon-btn mainbar-tip-align" valign={Gtk.Align.CENTER}
      $={(self: any) => {
        let flyout: BarFlyoutHandle | null = null
        let leaveTimer: any = null
        const cancelLeave = () => {
          if (leaveTimer) { GLib.source_remove(leaveTimer); leaveTimer = null }
        }
        self.connect('enter-notify-event', () => {
          cancelLeave()

          if (activeSysmonFlyout && activeSysmonFlyout.owner !== "cpu") {
            const previous = activeSysmonFlyout
            activeSysmonFlyout = null
            previous.handle.closeInstant()
          }

          if (!flyout) {
            const content = buildCpuFlyout()
            const handle = openBarFlyout(gdkmonitor, content, 7)
            flyout = handle
            activeSysmonFlyout = { owner: "cpu", handle }

            content.connect('destroy', () => {
              if (flyout === handle) flyout = null
              if (activeSysmonFlyout?.handle === handle) activeSysmonFlyout = null
            })
          }
        })
        self.connect('leave-notify-event', () => {
          leaveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            leaveTimer = null
            if (flyout) {
              const handle = flyout
              flyout = null
              if (activeSysmonFlyout?.handle === handle) activeSysmonFlyout = null
              handle.close()
            }
            return GLib.SOURCE_REMOVE
          })
        })
        onCleanup(() => {
          cancelLeave()
          if (flyout) {
            const handle = flyout
            flyout = null
            if (activeSysmonFlyout?.handle === handle) activeSysmonFlyout = null
            handle.close()
          }
        })
      }}
    >
      <box spacing={4} valign={Gtk.Align.CENTER} halign={Gtk.Align.CENTER}>
        {iconImage('cpu', IC.secondary, 15)}
        <label class="sysmon-val" label={cpuStr} xalign={0.5} />
      </box>
    </button>
  )
}

function RamWidget({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const [ramStr, setRamStr] = createState('-')

  const readRam = (): number => {
    try {
      const [ok, raw] = GLib.file_get_contents('/proc/meminfo')
      if (!ok) return 0
      const m: Record<string, number> = {}
      for (const line of _dec.decode(raw).split('\n')) {
        const p = line.match(/^(\w+):\s+(\d+)/)
        if (p) m[p[1]] = parseInt(p[2], 10)
      }
      const total = m['MemTotal'] ?? 0, avail = m['MemAvailable'] ?? 0
      return total > 0 ? Math.round((1 - avail / total) * 100) : 0
    } catch (_) { return 0 }
  }

  const update = () => setRamStr(`${readRam()}%`)
  update()
  const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(3000), () => { update(); return GLib.SOURCE_CONTINUE })
  onCleanup(() => GLib.source_remove(pollId))

  return (
    <button class="sys-btn sysmon-btn mainbar-tip-align" valign={Gtk.Align.CENTER}
      $={(self: any) => {
        let flyout: BarFlyoutHandle | null = null
        let leaveTimer: any = null
        const cancelLeave = () => {
          if (leaveTimer) { GLib.source_remove(leaveTimer); leaveTimer = null }
        }
        self.connect('enter-notify-event', () => {
          cancelLeave()

          if (activeSysmonFlyout && activeSysmonFlyout.owner !== "ram") {
            const previous = activeSysmonFlyout
            activeSysmonFlyout = null
            previous.handle.closeInstant()
          }

          if (!flyout) {
            const content = buildRamFlyout()
            const handle = openBarFlyout(gdkmonitor, content, 7)
            flyout = handle
            activeSysmonFlyout = { owner: "ram", handle }

            content.connect('destroy', () => {
              if (flyout === handle) flyout = null
              if (activeSysmonFlyout?.handle === handle) activeSysmonFlyout = null
            })
          }
        })
        self.connect('leave-notify-event', () => {
          leaveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            leaveTimer = null
            if (flyout) {
              const handle = flyout
              flyout = null
              if (activeSysmonFlyout?.handle === handle) activeSysmonFlyout = null
              handle.close()
            }
            return GLib.SOURCE_REMOVE
          })
        })
        onCleanup(() => {
          cancelLeave()
          if (flyout) {
            const handle = flyout
            flyout = null
            if (activeSysmonFlyout?.handle === handle) activeSysmonFlyout = null
            handle.close()
          }
        })
      }}
    >
      <box spacing={4} valign={Gtk.Align.CENTER} halign={Gtk.Align.CENTER}>
        {iconImage('ram', IC.secondary, 15)}
        <label class="sysmon-val" label={ramStr} xalign={0.5} />
      </box>
    </button>
  )
}

function NotifBell({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const [dnd, setDnd] = createState(isDndEnabled())
  const unsub = subscribeDnd(() => setDnd(isDndEnabled()))
  onCleanup(unsub)

  return (
    <button
      class={dnd.as((d: boolean) => d ? 'sys-btn notif-bell dnd' : 'sys-btn notif-bell')}
      valign={Gtk.Align.CENTER}
      tooltip_text={dnd.as((d: boolean) => d ? 'Notifications (DND)' : 'Notifications')}
      onClicked={() => toggleNotifCenter(gdkmonitor)}
    >
      {IconImg(dnd.as((d: boolean) => d ? 'bell-off' : 'bell'), IC.secondary, 15)}
    </button>
  )
}

interface TaskMenuEntry {
  icon: string
  label: string
  onFocus: () => void
}

interface TaskGroup {
  cls: string
  icon: string
  clients: any[]
}

const TASKBAR_MENU_W          = 240
const TASKBAR_MENU_MAX_ROWS   = 24
const TASKBAR_MENU_DELAY      = 500
const TASKBAR_MENU_GRACE      = 1500
const TASKBAR_DOUBLE_CLICK_MS = 400
const TASKBAR_LABEL_MAX       = 20
const TASKBAR_OVERFLOW_GAP    = 10
const TASKBAR_UNHIDE_SLACK    = 46

const recentByClass = new Map<string, string>()
let barCenterWsRef: Gtk.Widget | null = null

let activeTaskMenu: { win: Astal.Window; owner: Gtk.Widget } | null = null
let taskMenuCloseTimer = 0
let taskMenuPointerInside = false

function closeActiveTaskMenu() {
  if (taskMenuCloseTimer) {
    GLib.source_remove(taskMenuCloseTimer)
    taskMenuCloseTimer = 0
  }
  const menu = activeTaskMenu
  activeTaskMenu = null
  if (!menu) return
  try { menu.win.destroy() } catch (_) {}
}

function scheduleTaskMenuClose(delay = TASKBAR_MENU_GRACE) {
  cancelTaskMenuClose()
  taskMenuCloseTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
    taskMenuCloseTimer = 0
    if (!taskMenuPointerInside) closeActiveTaskMenu()
    return GLib.SOURCE_REMOVE
  })
}

function cancelTaskMenuClose() {
  if (taskMenuCloseTimer) {
    GLib.source_remove(taskMenuCloseTimer)
    taskMenuCloseTimer = 0
  }
}

function truncateMenuLabel(raw: unknown): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim()
  return s.length > TASKBAR_LABEL_MAX ? `${s.slice(0, TASKBAR_LABEL_MAX - 1)}…` : s
}

function clientTitle(client: any): string {
  return String(client?.title ?? client?.class ?? '')
}

function clientIcon(cls: string): string {
  return cls === 'unknown' ? 'application-x-executable-symbolic' : cls
}

function makeStableGroupBuilder(cache: Map<string, TaskGroup>) {
  return (clients: any[]): TaskGroup[] => {
    const out: TaskGroup[] = []
    const seen = new Set<string>()
    for (const client of clients) {
      const cls = String(client.class ?? '').toLowerCase() || 'unknown'
      let group = cache.get(cls)
      if (!group) {
        group = { cls, icon: clientIcon(cls), clients: [] }
        cache.set(cls, group)
      }
      if (!seen.has(cls)) {
        group.clients.length = 0
        seen.add(cls)
        out.push(group)
      }
      group.clients.push(client)
    }
    for (const group of out) {
      if (!recentByClass.has(group.cls)) {
        const last = group.clients[group.clients.length - 1]
        if (last?.address != null) recentByClass.set(group.cls, String(last.address))
      }
    }
    return out
  }
}

function focusTaskbarClient(client: any) {
  focusClient(client.address, client.class, (client as any).workspace?.id, '[taskbar]')
}

function openTaskMenu(owner: Gtk.Widget, entries: TaskMenuEntry[], gdkmonitor: Gdk.Monitor) {
  closeActiveTaskMenu()
  if (entries.length === 0) return

  const win = new (Astal.Window as any)({
    gdkmonitor,
    exclusivity: Astal.Exclusivity.IGNORE,
    layer:       Astal.Layer.OVERLAY,
    anchor:      Astal.WindowAnchor.BOTTOM | Astal.WindowAnchor.LEFT,
    keymode:     Astal.Keymode.NONE,
    application: app,
    namespace:   "ags-taskbar-menu",
  }) as Astal.Window

  win.get_style_context().add_class("TaskbarMenuWindow")
  const visual = win.get_screen()?.get_rgba_visual()
  if (visual) win.set_visual(visual)

  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 2,
    visible: true,
  })
  box.get_style_context().add_class("taskbar-menu-box")

  for (const entry of entries.slice(0, TASKBAR_MENU_MAX_ROWS)) {
    const row = new Gtk.Button({ visible: true })
    row.get_style_context().add_class("taskbar-menu-row")
    const content = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      visible: true,
    })
    content.add(new Gtk.Image({
      icon_name: entry.icon || "application-x-executable-symbolic",
      pixel_size: 18,
      visible: true,
    }))
    const label = new Gtk.Label({
      label: truncateMenuLabel(entry.label),
      xalign: 0,
      hexpand: true,
      visible: true,
    })
    label.get_style_context().add_class("taskbar-menu-label")
    label.set_ellipsize(3)
    label.set_max_width_chars(TASKBAR_LABEL_MAX)
    content.add(label)
    row.add(content)
    row.connect('enter-notify-event', () => {
      taskMenuPointerInside = true
      cancelTaskMenuClose()
      return false
    })
    row.connect('leave-notify-event', () => {
      taskMenuPointerInside = false
      scheduleTaskMenuClose()
      return false
    })
    row.connect('clicked', () => {
      closeActiveTaskMenu()
      entry.onFocus()
    })
    box.add(row)
  }

  win.add(box)
  win.set_size_request(TASKBAR_MENU_W, -1)
  box.set_size_request(TASKBAR_MENU_W, -1)

  let marginStart = 0
  try {
    const [, wx] = owner.translate_coordinates(owner.get_toplevel(), 0, 0)
    const monW = gdkmonitor.get_geometry()?.width ?? 0
    marginStart = Math.max(0, Math.min((wx ?? 0) - 6, Math.max(0, monW - TASKBAR_MENU_W)))
  } catch (_) {}

  win.margin_left = marginStart
  let marginBottom = 50
  try {
    const barH = owner.get_toplevel()?.get_allocation?.()?.height ?? 0
    if (Number.isFinite(barH) && barH > 0) marginBottom = barH
  } catch (_) {}
  win.margin_bottom = marginBottom

  win.connect('enter-notify-event', () => {
    taskMenuPointerInside = true
    cancelTaskMenuClose()
    return false
  })
  win.connect('leave-notify-event', (_w: any, event: Gdk.EventCrossing) => {
    if (event.detail === (Gdk as any).NotifyType.INFERIOR ||
        event.detail === (Gdk as any).NotifyType.VIRTUAL) return false
    taskMenuPointerInside = false
    scheduleTaskMenuClose()
    return false
  })
  win.connect('destroy', () => {
    if (activeTaskMenu?.win === win) activeTaskMenu = null
  })

  taskMenuPointerInside = false

  activeTaskMenu = { win, owner }
  win.show_all()
}

function wireTaskMenuHover(
  btn: Gtk.Button,
  getEntries: () => TaskMenuEntry[],
  gdkmonitor: Gdk.Monitor,
) {
  let openTimer = 0
  const cancelOpen = () => {
    if (openTimer) {
      GLib.source_remove(openTimer)
      openTimer = 0
    }
  }
  btn.connect('enter-notify-event', () => {
    cancelOpen()
    cancelTaskMenuClose()
    if (activeTaskMenu && activeTaskMenu.owner !== btn) closeActiveTaskMenu()
    if (!activeTaskMenu) {
      openTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TASKBAR_MENU_DELAY, () => {
        openTimer = 0
        openTaskMenu(btn, getEntries(), gdkmonitor)
        return GLib.SOURCE_REMOVE
      })
    }
    return false
  })
  btn.connect('leave-notify-event', () => {
    cancelOpen()
    if (activeTaskMenu?.owner === btn) scheduleTaskMenuClose()
    return false
  })
  btn.connect('destroy', () => {
    cancelOpen()
    if (activeTaskMenu?.owner === btn) closeActiveTaskMenu()
  })
}

function Taskbar({ gdkmonitor }: { gdkmonitor: Gdk.Monitor }) {
  const hypr = AstalHyprland.get_default()
  const groupCache = new Map<string, TaskGroup>()
  const buildStableGroups = makeStableGroupBuilder(groupCache)
  const groups = createBinding(hypr, "clients").as(buildStableGroups)

  const state: { groups: TaskGroup[]; hidden: number } = { groups: [], hidden: 0 }
  let rowRef: Gtk.Box | null = null
  let groupsRef: Gtk.Box | null = null
  let moreBtnRef: Gtk.Button | null = null
  let adjustQueued = false

  try {
    const unsubFocus = createBinding(hypr, 'focusedClient').subscribe(() => {
      const client: any = (hypr as any).focusedClient
      const cls = String(client?.class ?? '').toLowerCase()
      if (cls && client?.address != null) recentByClass.set(cls, String(client.address))
    })
    onCleanup(unsubFocus)
  } catch (_) {}

  onCleanup(() => {
    if (activeTaskMenu) closeActiveTaskMenu()
  })

  const syncGroups = (list: TaskGroup[]) => {
    state.groups = list
    if (state.hidden >= state.groups.length && state.groups.length > 0) {
      state.hidden = state.groups.length - 1
    }
    if (state.groups.length === 0) state.hidden = 0
    applyVisibility()
    scheduleAdjust()
  }

  const applyVisibility = () => {
    const total = state.groups.length
    const visibleCount = Math.max(0, total - state.hidden)
    try {
      let index = 0
      ;(groupsRef?.get_children() ?? []).forEach((child: any) => {
        if (!(child instanceof Gtk.Button)) return
        child.set_visible(index < visibleCount)
        index++
      })
    } catch (_) {}
    moreBtnRef?.set_visible(total > 0 && state.hidden > 0)
  }

  const contentRightEdge = (includeMore = true): number => {
    const row = rowRef
    if (!row) return Number.NaN
    const toplevel = row.get_toplevel()
    let maxR = Number.NEGATIVE_INFINITY
    const measure = (w: Gtk.Widget) => {
      try {
        const a = w.get_allocation()
        const [, rx] = w.translate_coordinates(toplevel, a.width, 0)
        if (Number.isFinite(rx) && rx > maxR) maxR = rx
      } catch (_) {}
    }
    try {
      ;(groupsRef?.get_children() ?? []).forEach((child: any) => {
        if (child instanceof Gtk.Button && child.get_visible()) measure(child)
      })
      if (includeMore && moreBtnRef?.get_visible()) measure(moreBtnRef)
    } catch (_) {}
    return maxR
  }

  const scheduleAdjust = () => {
    if (adjustQueued || !rowRef) return
    adjustQueued = true
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      adjustQueued = false
      adjustOverflow()
      return GLib.SOURCE_REMOVE
    })
  }

  const adjustOverflow = () => {
    const row = rowRef
    if (!row || state.groups.length === 0) return
    try {
      const toplevel = row.get_toplevel()
      const center = barCenterWsRef
      if (!center || center === row) return
      const rightEdge = contentRightEdge()
      if (!Number.isFinite(rightEdge)) return
      const aC = center.get_allocation()
      const [, centerLeft] = center.translate_coordinates(toplevel, 0, Math.floor(aC.height / 2))
      if (!Number.isFinite(centerLeft)) return
      const limit = centerLeft - TASKBAR_OVERFLOW_GAP
      const total = state.groups.length
      if (rightEdge > limit && state.hidden < total) {
        state.hidden += 1
        applyVisibility()
        scheduleAdjust()
      } else if (state.hidden > 1 && rightEdge + TASKBAR_UNHIDE_SLACK <= limit) {
        state.hidden -= 1
        applyVisibility()
        scheduleAdjust()
      } else if (state.hidden === 1) {
        const edgeNoMore = contentRightEdge(false)
        if (Number.isFinite(edgeNoMore) && edgeNoMore + TASKBAR_UNHIDE_SLACK <= limit) {
          state.hidden = 0
          applyVisibility()
          scheduleAdjust()
        }
      }
    } catch (_) {}
  }

  const groupEntries = (group: TaskGroup): TaskMenuEntry[] => group.clients.map(client => ({
    icon: group.icon,
    label: clientTitle(client),
    onFocus: () => focusTaskbarClient(client),
  }))

  const hiddenEntries = (): TaskMenuEntry[] => {
    const total = state.groups.length
    if (state.hidden <= 0) return []
    return state.groups.slice(total - state.hidden).flatMap(group =>
      group.clients.map(client => ({
        icon: group.icon,
        label: clientTitle(client),
        onFocus: () => focusTaskbarClient(client),
      })),
    )
  }

  const groupButton = (group: TaskGroup) => {
    const pickRecent = (): any => {
      const recent = recentByClass.get(group.cls)
      return group.clients.find(c => String(c.address) === recent) ?? group.clients[0]
    }
    return (
      <button
        class="task-btn"
        $={(self: any) => {
          self.set_no_show_all(true)
          let lastClickAt = 0
          self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK)
          self.connect('button-press-event', () => {
            if (group.clients.length === 0) return false
            const now = Date.now()
            const isDouble = now - lastClickAt < TASKBAR_DOUBLE_CLICK_MS
            lastClickAt = now
            if (isDouble && group.clients.length > 1) {
              const currentAddr = String(pickRecent()?.address ?? '')
              const idx = Math.max(0, group.clients.findIndex(
                c => String(c.address) === currentAddr,
              ))
              const next = group.clients[(idx + 1) % group.clients.length]
              focusTaskbarClient(next)
              recentByClass.set(group.cls, String(next.address))
            } else {
              const target = pickRecent()
              if (target) {
                focusTaskbarClient(target)
                recentByClass.set(group.cls, String(target.address))
              }
            }
            return true
          })
          wireTaskMenuHover(self, () => groupEntries(group), gdkmonitor)
        }}
      >
        <Gtk.Image icon_name={group.icon} pixel_size={18} />
      </button>
    ) as Gtk.Button
  }

  try {
    const unsubGroups = createBinding(hypr, 'clients').subscribe(() => {
      syncGroups(buildStableGroups((hypr.clients ?? []) as any[]))
    })
    onCleanup(unsubGroups)
  } catch (_) {}
  syncGroups(buildStableGroups((hypr.clients ?? []) as any[]))

  return (
    <box
      class="taskbar"
      spacing={4}
      $={(self: any) => {
        rowRef = self
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
          applyVisibility()
          scheduleAdjust()
          return GLib.SOURCE_REMOVE
        })
        const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(1000), () => {
          scheduleAdjust()
          return GLib.SOURCE_CONTINUE
        })
        onCleanup(() => {
          GLib.source_remove(pollId)
          if (rowRef === self) rowRef = null
        })
      }}
    >
      <box
        class="taskbar-groups"
        spacing={4}
        $={(self: any) => {
          groupsRef = self
          onCleanup(() => { if (groupsRef === self) groupsRef = null })
        }}
      >
        <For each={groups}>
          {(group: TaskGroup) => groupButton(group)}
        </For>
      </box>
      <button
        class="task-btn taskbar-more"
        visible={false}
        $={(self: any) => {
          moreBtnRef = self
          self.set_no_show_all(true)
          self.set_visible(false)
          self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK)
          self.connect('button-press-event', () => {
            if (activeTaskMenu?.owner === self) closeActiveTaskMenu()
            else openTaskMenu(self, hiddenEntries(), gdkmonitor)
            return true
          })
          wireTaskMenuHover(self, hiddenEntries, gdkmonitor)
          onCleanup(() => { if (moreBtnRef === self) moreBtnRef = null })
        }}
      >
        <label label="[>]" />
      </button>
    </box>
  )
}

const TRAY_HIDDEN = new Set(['blueman', 'blueman-applet'])

function Tray() {
  const tray = AstalTray.get_default()
  const visibleItems = createBinding(tray, "items").as(
    (list: AstalTray.TrayItem[]) => list.filter(
      (item) => !TRAY_HIDDEN.has((item.id ?? '').toLowerCase())
    )
  )
  return (
    <box class="tray" spacing={2}>
      <For each={visibleItems}>
        {(item: AstalTray.TrayItem) => (
          <button class="tray-item"
            onClicked={() => { try { item.activate(0, 0) } catch (_) {} }}
            tooltip_text={createBinding(item, "title")}
            $={(self: any) => {
              self.add_events(Gdk.EventMask.BUTTON_PRESS_MASK)
              self.connect('button-press-event', (_: any, evt: any) => {
                const [, btn] = evt.get_button()
                if (btn === 3) {
                  try { item.about_to_show() } catch (_) {}
                  try {
                    const model = item.menu_model
                    if (model) {
                      const menu = Gtk.Menu.new_from_model(model)
                      menu.insert_action_group('dbusmenu', item.action_group)
                      menu.show_all()
                      menu.popup_at_widget(self, Gdk.Gravity.SOUTH, Gdk.Gravity.NORTH, null)
                    }
                  } catch (_) {}
                  return true
                }
                return false
              })
            }}
          >
            <Gtk.Image gicon={createBinding(item, "gicon")} pixel_size={16} />
          </button>
        )}
      </For>
    </box>
  )
}

function Sep() {
  return <box class="divider-v" />
}

function PrivacyIndicator() {
  const screenShareTestMarker = `${GLib.get_user_runtime_dir()}/fn-screenshare-test`
  let alive = true
  let scanInFlight = false
  let previousMask = -1
  let debugScanCounter = 0

  let rootBox: Gtk.Box | null = null
  let cameraImage: Gtk.Image | null = null
  let screenImage: Gtk.Image | null = null
  let microphoneImage: Gtk.Image | null = null

  type PwNode = {
    id: number
    state: string
    props: Record<string, any>
  }

  const textProp = (node: PwNode, key: string): string =>
    String(node.props?.[key] ?? '')

  const boolProp = (node: PwNode, key: string): boolean => {
    const value = node.props?.[key]
    return value === true || String(value).trim().toLowerCase() === 'true'
  }

  const running = (node: PwNode): boolean =>
    node.state.trim().toLowerCase() === 'running'

  const nodeInfo = (node: PwNode): string => [
    `id=${node.id}`,
    `state=${node.state || '-'}`,
    `class=${textProp(node, 'media.class') || '-'}`,
    `role=${textProp(node, 'media.role') || '-'}`,
    `node=${textProp(node, 'node.name') || '-'}`,
    `description=${textProp(node, 'node.description') || '-'}`,
    `app=${textProp(node, 'application.name') || '-'}`,
    `device.api=${textProp(node, 'device.api') || '-'}`,
    `capture.sink=${String(node.props?.['stream.capture.sink'] ?? '-')}`,
    `target=${textProp(node, 'target.object') || '-'}`,
  ].join(' | ')

  const isCamera = (node: PwNode): boolean => {
    if (textProp(node, 'media.class') !== 'Video/Source') return false

    const role = textProp(node, 'media.role').toLowerCase()
    const api = textProp(node, 'device.api').toLowerCase()
    const metadata = [
      textProp(node, 'node.name'),
      textProp(node, 'node.description'),
      textProp(node, 'media.name'),
    ].join(' ')

    return role === 'camera'
      || api === 'v4l2'
      || api === 'libcamera'
      || /(v4l2|libcamera|webcam|camera)/i.test(metadata)
  }

  const isScreenRecorder = (node: PwNode): boolean => {
    if (textProp(node, 'media.class') !== 'Stream/Input/Video') return false

    const role = textProp(node, 'media.role').toLowerCase()
    const metadata = [
      textProp(node, 'node.name'),
      textProp(node, 'node.description'),
      textProp(node, 'application.name'),
      textProp(node, 'media.name'),
    ].join(' ')

    return role === 'screen'
      || /(screen|screencast|desktop|portal|monitor capture|window capture)/i.test(metadata)
  }

  const isScreenPortal = (node: PwNode): boolean => {
    if (textProp(node, 'media.class') !== 'Video/Source') return false
    if (isCamera(node)) return false

    const metadata = [
      textProp(node, 'node.name'),
      textProp(node, 'node.description'),
      textProp(node, 'media.name'),
    ].join(' ')

    return /(xdg-desktop-portal|portal-hyprland|screencast)/i.test(metadata)
  }

  const isPhysicalMicSource = (node: PwNode): boolean => {
    const mediaClass = textProp(node, 'media.class')
    if (mediaClass !== 'Audio/Source') return false

    const metadata = [
      textProp(node, 'node.name'),
      textProp(node, 'node.description'),
    ].join(' ')

    if (/(monitor|easy effects source|easyeffects_source)/i.test(metadata)) return false
    return true
  }

  const isMicRecorder = (node: PwNode): boolean => {
    if (textProp(node, 'media.class') !== 'Stream/Input/Audio') return false
    if (!running(node)) return false
    if (boolProp(node, 'stream.capture.sink')) return false

    const metadata = [
      textProp(node, 'node.name'),
      textProp(node, 'node.description'),
      textProp(node, 'application.name'),
      textProp(node, 'media.name'),
    ].join(' ')

    if (/(cava|discord_capture|game capture|monitor|loopback)/i.test(metadata)) return false
    return true
  }

  const recorderUsesSource = (recorder: PwNode, sources: PwNode[]): boolean => {
    const target = textProp(recorder, 'target.object')

    if (!target) return sources.length > 0

    return sources.some(source => {
      const sourceName = textProp(source, 'node.name')
      return target === sourceName
        || target === String(source.id)
        || (sourceName && target.includes(sourceName))
    })
  }

  const setVisibility = (mask: number) => {
    const camera = (mask & 1) !== 0
    const screen = (mask & 2) !== 0
    const microphone = (mask & 4) !== 0

    cameraImage?.set_visible(camera)
    screenImage?.set_visible(screen)
    microphoneImage?.set_visible(microphone)
    const active = camera || screen || microphone
    rootBox?.set_visible(active)
    const context = rootBox?.get_style_context()
    if (active) context?.add_class('privacy-active')
    else context?.remove_class('privacy-active')

    const tooltip: string[] = []
    if (camera) tooltip.push('Camera in use')
    if (screen) tooltip.push('Screen sharing active')
    if (microphone) tooltip.push('Microphone in use')
    rootBox?.set_tooltip_text(tooltip.join(' · '))
  }

  const parseDump = (raw: string): PwNode[] => {
    const objects = JSON.parse(raw)
    if (!Array.isArray(objects)) return []

    const nodes: PwNode[] = []

    for (const object of objects) {
      if (object?.type !== 'PipeWire:Interface:Node') continue

      const id = Number(object?.id)
      if (!Number.isFinite(id)) continue

      nodes.push({
        id,
        state: String(object?.info?.state ?? ''),
        props: object?.info?.props ?? {},
      })
    }

    return nodes
  }

  const evaluate = (nodes: PwNode[]) => {
    const activeCameras = nodes.filter(node => isCamera(node) && running(node))

    const activeScreenRecorders = nodes.filter(node =>
      isScreenRecorder(node) && running(node)
    )

    const activeScreenPortals = nodes.filter(node =>
      isScreenPortal(node) && running(node)
    )

    const activeMicSources = nodes.filter(node =>
      isPhysicalMicSource(node) && running(node)
    )

    const activeMicRecorders = nodes.filter(node =>
      isMicRecorder(node) && recorderUsesSource(node, activeMicSources)
    )

    const cameraActive = activeCameras.length > 0
    const screenTestActive = GLib.file_test(screenShareTestMarker, GLib.FileTest.EXISTS)
    const screenActive = activeScreenRecorders.length > 0 || activeScreenPortals.length > 0 || screenTestActive
    const microphoneActive = activeMicSources.length > 0 && activeMicRecorders.length > 0

    let mask = 0
    if (cameraActive) mask |= 1
    if (screenActive) mask |= 2
    if (microphoneActive) mask |= 4

    setVisibility(mask)

    debugScanCounter++
    const changed = mask !== previousMask
    const heartbeat = FN_DEBUG && debugScanCounter % 5 === 0

    if (FN_DEBUG && (changed || heartbeat)) {
      logFn(
        'AGS',
        'debug',
        changed ? 'Status icons changed' : 'Status icons scan',
        [
          `mask=${mask}`,
          `camera=${cameraActive}`,
          `screen=${screenActive}`,
          `microphone=${microphoneActive}`,
          `camera.nodes=${activeCameras.length}`,
          `screen.recorders=${activeScreenRecorders.length}`,
          `screen.portals=${activeScreenPortals.length}`,
          `microphone.sources=${activeMicSources.length}`,
          `microphone.recorders=${activeMicRecorders.length}`,
          `gtk.root=${rootBox?.get_visible?.() ?? false}`,
          `gtk.camera=${cameraImage?.get_visible?.() ?? false}`,
          `gtk.screen=${screenImage?.get_visible?.() ?? false}`,
          `gtk.microphone=${microphoneImage?.get_visible?.() ?? false}`,
        ].join(' | '),
      )

      for (const node of activeCameras) {
        logFn('AGS', 'debug', 'Status icon CAMERA trigger', nodeInfo(node))
      }

      for (const node of activeScreenRecorders) {
        logFn('AGS', 'debug', 'Status icon SCREEN recorder trigger', nodeInfo(node))
      }

      for (const node of activeScreenPortals) {
        logFn('AGS', 'debug', 'Status icon SCREEN portal trigger', nodeInfo(node))
      }

      for (const node of activeMicSources) {
        logFn('AGS', 'debug', 'Status icon MICROPHONE source trigger', nodeInfo(node))
      }

      for (const node of activeMicRecorders) {
        logFn('AGS', 'debug', 'Status icon MICROPHONE recorder trigger', nodeInfo(node))
      }

      if (!screenActive) {
        const candidates = nodes.filter(node =>
          textProp(node, 'media.class') === 'Stream/Input/Video'
          || isScreenPortal(node)
        )
        for (const node of candidates) {
          logFn('AGS', 'debug', 'Status icon SCREEN candidate inactive', nodeInfo(node))
        }
      }

      if (!microphoneActive) {
        const candidates = nodes.filter(node =>
          textProp(node, 'media.class') === 'Audio/Source'
          || textProp(node, 'media.class') === 'Stream/Input/Audio'
        )
        for (const node of candidates) {
          logFn('AGS', 'debug', 'Status icon MICROPHONE candidate inactive', nodeInfo(node))
        }
      }
    }

    previousMask = mask
  }

  const scan = async () => {
    if (!alive || scanInFlight) return
    scanInFlight = true

    try {
      const raw = await execAsync(['pw-dump'])
      if (!alive) return
      evaluate(parseDump(raw))
    } catch (e) {
      if (FN_DEBUG) {
        logFn('AGS', 'debug', 'Status icons pw-dump failed', String(e))
      }
    } finally {
      scanInFlight = false
    }
  }

  const widget = (
    <box
      class="privacy-indicator"
      spacing={5}
      $={(self: any) => {
        rootBox = self
        self.set_no_show_all(true)
        self.set_visible(false)
        self.get_accessible()?.set_name('Privacy activity')
      }}
    >
      <Gtk.Image
        icon_name="camera-web-symbolic"
        pixel_size={15}
        $={(self: any) => {
          cameraImage = self
          self.set_no_show_all(true)
          self.set_visible(false)
        }}
      />
      <Gtk.Image
        icon_name="screen-shared-symbolic"
        pixel_size={13}
        $={(self: any) => {
          screenImage = self
          self.set_no_show_all(true)
          self.set_visible(false)
        }}
      />
      <Gtk.Image
        icon_name="audio-input-microphone-symbolic"
        pixel_size={13}
        $={(self: any) => {
          microphoneImage = self
          self.set_no_show_all(true)
          self.set_visible(false)
        }}
      />
    </box>
  ) as Gtk.Box

  const pollId = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    clampInterval(3000),
    () => {
      void scan()
      return GLib.SOURCE_CONTINUE
    },
  )

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    void scan()
    return GLib.SOURCE_REMOVE
  })

  onCleanup(() => {
    alive = false
    try { GLib.source_remove(pollId) } catch (_) {}
  })

  return widget
}

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  let balanceLRef: Gtk.Box | null = null
  let balanceRRef: Gtk.Box | null = null
  let balanceLastL = 0
  let balanceLastR = 0

  const leftBox = (
    <box class="bar-left" valign={Gtk.Align.CENTER} spacing={6}>
      <Launcher />
      <Sep />
      <box class="seg">
        <Clock />
        <CalendarWidget gdkmonitor={gdkmonitor} />
      </box>
      <Sep />
      <ColorPicker />
      <Sep />
      <Taskbar gdkmonitor={gdkmonitor} />
      <box
        class="center-balance-l"
        $={(self: any) => { balanceLRef = self }}
      />
    </box>
  ) as Gtk.Widget

  const centerBox = (
    <box
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
      $={(self: any) => {
        self.set_name('bar-center-ws')
        barCenterWsRef = self
      }}
    >
      <WorkspacesWidget />
    </box>
  ) as Gtk.Widget

  const rightBox = (
    <box class="bar-right" halign={Gtk.Align.END} valign={Gtk.Align.CENTER} spacing={6}>
      <box
        class="center-balance-r"
        $={(self: any) => { balanceRRef = self }}
      />
      <Tray />
      <Sep />
      <box class="seg">
        <VolumeWidget gdkmonitor={gdkmonitor} />
        <MicWidget gdkmonitor={gdkmonitor} />
      </box>
      <box class="seg seg-sysmon">
        <CpuWidget gdkmonitor={gdkmonitor} />
        <RamWidget gdkmonitor={gdkmonitor} />
      </box>
      <box class="seg">
        <NetworkWidget gdkmonitor={gdkmonitor} />
        <BluetoothWidget gdkmonitor={gdkmonitor} />
      </box>
      <box class="seg">
        <BatteryWidget />
        <VpnWidget />
        <PrivacyIndicator />
        <NotifBell gdkmonitor={gdkmonitor} />
      </box>
    </box>
  ) as Gtk.Widget

  const root = (
    <box class="bar-root main-bar-root" spacing={0}
      $={(self: any) => {
        self.pack_start(leftBox, true, true, 0)
        self.set_center_widget(centerBox)
        self.pack_end(rightBox, true, true, 0)

        const naturalWidth = (w: Gtk.Widget | null): number => {
          try {
            if (!w) return 0
            const [, nat] = w.get_preferred_width()
            return Number.isFinite(nat) ? nat : 0
          } catch (_) { return 0 }
        }
        const applyBalance = () => {
          try {
            const lNat = naturalWidth(leftBox) - balanceLastL
            const rNat = naturalWidth(rightBox) - balanceLastR
            const diff = rNat - lNat
            if (diff > 1) {
              if (balanceLastL !== diff && balanceLRef) {
                balanceLRef.set_size_request(diff, -1)
                balanceLastL = diff
              }
              if (balanceLastR !== 0 && balanceRRef) {
                balanceRRef.set_size_request(0, -1)
                balanceLastR = 0
              }
            } else if (diff < -1) {
              const pad = -diff
              if (balanceLastR !== pad && balanceRRef) {
                balanceRRef.set_size_request(pad, -1)
                balanceLastR = pad
              }
              if (balanceLastL !== 0 && balanceLRef) {
                balanceLRef.set_size_request(0, -1)
                balanceLastL = 0
              }
            }
          } catch (_) {}
        }
        applyBalance()
        const pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(1000), () => {
          applyBalance()
          return GLib.SOURCE_CONTINUE
        })
        onCleanup(() => GLib.source_remove(pollId))
      }}
    />
  ) as Gtk.Widget

  const barWin = new (Astal.Window as any)({
    gdkmonitor,
    exclusivity: Astal.Exclusivity.EXCLUSIVE,
    layer: Astal.Layer.OVERLAY,
    anchor: BOTTOM | LEFT | RIGHT,
    keymode: Astal.Keymode.NONE,
    application: app,
    namespace: "ags-bar",
  }) as Astal.Window

  const screen = barWin.get_screen()
  const visual = screen?.get_rgba_visual()
  if (visual) barWin.set_visual(visual)

  let barHidden = false
  const setBarHidden = (hidden: boolean) => {
    if (barHidden === hidden) return
    barHidden = hidden
    try {
      barWin.set_opacity(hidden ? 0 : 1)
      const region = hidden ? new cairo.Region() : null
      ;(barWin as any).input_shape_combine_region(region)
    } catch (_) {}
  }
  const hyprService = AstalHyprland.get_default()
  const applyFocusedWsFullscreen = () => {
    try {
      const ws: any = (hyprService as any)?.focusedWorkspace
      setBarHidden(!!(ws?.hasFullscreen ?? ws?.has_fullscreen ?? false))
    } catch (_) {}
  }
  let focusedWsUnsub: (() => void) | null = null
  if (hyprService) {
    try {
      focusedWsUnsub = createBinding(hyprService as any, 'focusedWorkspace').subscribe(applyFocusedWsFullscreen)
    } catch (_) {}
  }
  const hyprEventId = hyprService?.connect?.('event', (_s: any, name: string, data: string) => {
    if (name === 'fullscreen') setBarHidden((data || '').trim().startsWith('1'))
  })
  applyFocusedWsFullscreen()
  onCleanup(() => {
    if (focusedWsUnsub) { try { focusedWsUnsub() } catch (_) {} }
    if (hyprService && hyprEventId) {
      try { hyprService.disconnect(hyprEventId) } catch (_) {}
    }
    closeAudioMixerMenu()
    try { barWin.destroy() } catch (_) {}
  })

  barWin.get_style_context().add_class("Bar")
  barWin.add(root)
  barWin.show_all()

  return barWin
}
