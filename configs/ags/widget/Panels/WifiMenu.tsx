// Wifi Menu
import Gtk from "gi://Gtk?version=3.0"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { clampInterval } from "../Helpers/Perf"
import { Gdk, Astal } from "ags/gtk3"
import { execAsync } from "ags/process"
import app from "ags/gtk3/app"
import { iconImage, IC } from "../Helpers/Icons"
import { makeErrorToast } from "../Helpers/Toast"
import { derr } from "../Helpers/DashLog"
import { registerFlyout, trackEscapeDismiss } from "../Helpers/FlyoutState"
import {
  networkFlyoutLayoutEnabled,
  networkFlyoutWidth,
  registerNetworkFlyout,
} from "../Helpers/NetworkFlyoutLayout"

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

function getIfaceBytes(iface: string): { rx: number, tx: number } | null {
  try {
    const [ok, raw] = GLib.file_get_contents('/proc/net/dev')
    if (!ok) return null
    for (const line of _dec.decode(raw).split('\n')) {
      if (line.trim().startsWith(iface + ':')) {
        const parts = line.trim().split(':')[1].trim().split(/\s+/)
        return { rx: parseInt(parts[0], 10), tx: parseInt(parts[8], 10) }
      }
    }
  } catch (_) {}
  return null
}

function fmtSpeed(bps: number): string {
  bps = Math.round(bps)
  if (bps < 1000)           return `${bps}B`
  if (bps < 1_000_000)      return `${Math.round(bps / 1000)}K`
  if (bps < 1_000_000_000)  return `${(bps / 1_000_000).toFixed(1)}M`
  return `${(bps / 1_000_000_000).toFixed(1)}G`
}

interface WifiAP {
  ssid: string
  bssid: string
  channel: string
  freq: string
  signal: number
  security: string
  active: boolean
}

const IWD_SERVICE = 'net.connman.iwd'
const IWD_ROOT = '/net/connman/iwd'
const wifiScans = new Map<string, Promise<void>>()
const IWD_AGENT_XML = `
<node>
  <interface name="net.connman.iwd.Agent">
    <method name="Release"/>
    <method name="RequestPassphrase">
      <arg type="o" name="network" direction="in"/>
      <arg type="s" name="passphrase" direction="out"/>
    </method>
    <method name="RequestPrivateKeyPassphrase">
      <arg type="o" name="network" direction="in"/>
      <arg type="s" name="passphrase" direction="out"/>
    </method>
  </interface>
</node>`

function dbusCall(
  connection: Gio.DBusConnection,
  path: string,
  iface: string,
  method: string,
  parameters: GLib.Variant | null,
  timeoutMs = 45_000,
): Promise<GLib.Variant> {
  return new Promise((resolve, reject) => {
    connection.call(
      IWD_SERVICE,
      path,
      iface,
      method,
      parameters,
      null,
      Gio.DBusCallFlags.NONE,
      timeoutMs,
      null,
      (_connection, result) => {
        try { resolve(connection.call_finish(result)) }
        catch (error) { reject(error) }
      },
    )
  })
}

function unpackVariant(value: any): any {
  try { return value instanceof GLib.Variant ? value.deepUnpack() : value }
  catch (_) { return value }
}

async function iwdObjects(connection: Gio.DBusConnection): Promise<Record<string, any>> {
  const response = await dbusCall(
    connection,
    '/',
    'org.freedesktop.DBus.ObjectManager',
    'GetManagedObjects',
    null,
    5_000,
  )
  const unpacked: any = response.deepUnpack()
  return (Array.isArray(unpacked) ? unpacked[0] : unpacked) ?? {}
}

function findIwdPaths(objects: Record<string, any>, iface: string, ssid: string): {
  stationPath: string
  networkPath: string
} {
  let stationPath = ''
  let networkPath = ''
  for (const [path, interfaces] of Object.entries(objects)) {
    const entry = interfaces as Record<string, Record<string, any>>
    const device = entry['net.connman.iwd.Device']
    if (device && String(unpackVariant(device.Name) ?? '') === iface) stationPath = path
  }
  for (const [path, interfaces] of Object.entries(objects)) {
    const network = (interfaces as Record<string, Record<string, any>>)['net.connman.iwd.Network']
    if (!network || String(unpackVariant(network.Name) ?? '') !== ssid) continue
    const devicePath = String(unpackVariant(network.Device) ?? '')
    if (!stationPath || devicePath === stationPath) {
      networkPath = path
      if (!stationPath) stationPath = devicePath
      break
    }
  }
  return { stationPath, networkPath }
}

async function busGetSystem(): Promise<Gio.DBusConnection> {
  return new Promise((resolve, reject) => {
    Gio.bus_get(Gio.BusType.SYSTEM, null, (_source, result) => {
      try { resolve(Gio.bus_get_finish(result)) }
      catch (error) { reject(error) }
    })
  })
}

async function fetchKnownNetworks(): Promise<Set<string>> {
  const known = new Set<string>()
  try {
    const connection = await busGetSystem()
    const objects = await iwdObjects(connection)
    for (const interfaces of Object.values(objects)) {
      const kn = (interfaces as Record<string, Record<string, any>>)['net.connman.iwd.KnownNetwork']
      if (!kn) continue
      const name = String(unpackVariant(kn.Name) ?? '')
      if (name) known.add(name)
    }
  } catch (_) {}
  return known
}

async function connectIwd(iface: string, ssid: string, passphrase: string, hidden: boolean): Promise<void> {
  const connection = await busGetSystem()
  const objects = await iwdObjects(connection)
  const { stationPath, networkPath } = findIwdPaths(objects, iface, ssid)
  if (!stationPath) throw new Error(`iwd station not found for ${iface}`)
  if (!hidden && !networkPath) throw new Error('Network disappeared; rescan and try again')

  let secret = passphrase
  let agent: Gio.DBusExportedObject | null = null
  let agentPath = ''
  let registered = false
  try {
    if (secret) {
      agentPath = `/org/finixtavh/AgsIwdAgent/a${GLib.get_monotonic_time()}`
      agent = Gio.DBusExportedObject.wrapJSObject(IWD_AGENT_XML, {
        Release: () => {},
        RequestPassphrase: (_network: string) => secret,
        RequestPrivateKeyPassphrase: (_network: string) => secret,
      })
      agent.export(connection, agentPath)
      await dbusCall(
        connection,
        IWD_ROOT,
        'net.connman.iwd.AgentManager',
        'RegisterAgent',
        new GLib.Variant('(o)', [agentPath]),
        5_000,
      )
      registered = true
    }

    if (hidden) {
      await dbusCall(
        connection,
        stationPath,
        'net.connman.iwd.Station',
        'ConnectHiddenNetwork',
        new GLib.Variant('(s)', [ssid]),
      )
    } else {
      await dbusCall(connection, networkPath, 'net.connman.iwd.Network', 'Connect', null)
    }
  } finally {
    secret = ''
    if (registered) {
      try {
        await dbusCall(
          connection,
          IWD_ROOT,
          'net.connman.iwd.AgentManager',
          'UnregisterAgent',
          new GLib.Variant('(o)', [agentPath]),
          5_000,
        )
      } catch (_) {}
    }
    try { agent?.unexport() } catch (_) {}
  }
}

function getWifiIface(): string {
  try {
    const dir = GLib.Dir.open('/sys/class/net', 0)
    let entry = dir.read_name()
    while (entry !== null) {
      if (GLib.file_test(`/sys/class/net/${entry}/wireless`, GLib.FileTest.IS_DIR)) {
        dir.close()
        return entry
      }
      entry = dir.read_name()
    }
    dir.close()
  } catch (_) {}
  return 'wlan0'
}

function requestWifiScan(iface: string): Promise<void> {
  const activeScan = wifiScans.get(iface)
  if (activeScan) return activeScan

  const scan = execAsync(['iwctl', 'station', iface, 'scan']).then(() => undefined)
  wifiScans.set(iface, scan)
  const clear = () => {
    if (wifiScans.get(iface) === scan) wifiScans.delete(iface)
  }
  scan.then(clear, clear)
  return scan
}

function visibleIdx(rawLine: string, visTarget: number): number {
  let vis = 0, i = 0
  while (i < rawLine.length) {
    if (rawLine[i] === '\x1b') {
      i++
      while (i < rawLine.length && !/[A-Za-z]/.test(rawLine[i])) i++
      i++
      continue
    }
    if (vis === visTarget) return i
    vis++; i++
  }
  return rawLine.length
}

function parseIwctlNetworks(raw: string): WifiAP[] {
  const rawLines   = raw.replace(/\r/g, '').split('\n')
  const cleanLines = rawLines.map(l => l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''))

  const aps: WifiAP[] = []
  let colSsid = -1, colSec = -1, colSig = -1
  let headerFound = false, dataMode = false

  for (let li = 0; li < cleanLines.length; li++) {
    const cl = cleanLines[li]
    const rl = rawLines[li]
    if (!cl.trim()) continue

    if (!headerFound && cl.includes('Network name') && cl.includes('Security')) {
      colSsid = cl.indexOf('Network name')
      colSec  = cl.indexOf('Security')
      colSig  = cl.indexOf('Signal')
      headerFound = true
      continue
    }
    if (headerFound && !dataMode && cl.trim().replace(/-/g, '') === '') {
      dataMode = true; continue
    }
    if (!dataMode || colSsid < 0) continue
    if (cl.trim().replace(/-/g, '') === '') continue
    if (cl.includes('Available networks')) continue
    if (cl.length < colSec) continue

    const active = cl.slice(0, colSsid).includes('>')
    const ssid   = cl.slice(colSsid, colSec > 0 ? colSec : undefined).trim()
    const sec    = colSec > 0 ? cl.slice(colSec, colSig > 0 ? colSig : undefined).trim() : ''

    let activeStars = 0
    if (colSig > 0 && rl.length > 0) {
      const rawStart  = visibleIdx(rl, colSig)
      const rawSigStr = rl.slice(rawStart).replace(/^ +/, '')
      activeStars     = (rawSigStr.match(/^\*+/) || [''])[0].length
    }
    const signal = Math.min(100, activeStars * 25)

    if (!ssid) continue

    let security = '--'
    const secl = sec.toLowerCase().replace(/[\s-]/g, '')
    if (secl === 'psk' || secl === 'psksha256') security = 'WPA2'
    else if (secl === 'sae')                    security = 'WPA3'
    else if (secl === 'psksae')                 security = 'WPA2/3'
    else if (secl === '8021x')                  security = 'WPA2-EAP'
    else if (secl === 'open' || secl === 'none' || secl === '') security = '--'
    else if (sec)                               security = sec

    aps.push({ ssid, bssid: '', channel: '', freq: '', signal, security, active })
  }

  return aps.sort((a, b) => a.active === b.active ? b.signal - a.signal : a.active ? -1 : 1)
}

function sigName(pct: number): string {
  if (pct > 66) return 'wifi'
  if (pct > 33) return 'wifi-mid'
  return 'wifi-low'
}

function secShort(sec: string): string {
  if (!sec || sec === '--') return 'Open'
  if (sec.includes('WPA3') && sec.includes('WPA2')) return 'WPA2/3'
  if (sec.includes('WPA3')) return 'WPA3'
  if (sec.includes('WPA2')) return 'WPA2'
  if (sec.includes('WPA')) return 'WPA'
  return sec.slice(0, 8)
}

function cls(w: Gtk.Widget, ...names: string[]) {
  const ctx = w.get_style_context()
  names.forEach(n => ctx.add_class(n))
}

function mkIconBtn(icon: string, tip: string): Gtk.Button {
  const b = new Gtk.Button({ visible: true, tooltip_text: tip })
  b.add(iconImage(icon, IC.secondary, 15))
  cls(b, 'wifi-icon-btn')
  return b
}

export function openWifiMenu(gdkmonitor: Gdk.Monitor): () => void {
  if (!GLib.find_program_in_path('iwctl')) return () => {}

  let closed = false
  let expandedSsid: string | null = null
  let visibleAps: WifiAP[] = []
  const detailPanels: Gtk.Widget[] = []
  const apRefs: WifiAP[] = []
  const managedLayout = networkFlyoutLayoutEnabled()
  let unregisterNetworkLayout = () => {}
  let listRebuildId: number | null = null
  let scanRefreshId: number | null = null
  let scanGeneration = 0

  const iface = getWifiIface()

  let knownNets = new Set<string>()
  fetchKnownNetworks().then(set => { if (!closed) knownNets = set })

  const { BOTTOM, RIGHT } = Astal.WindowAnchor
  const win = new (Astal.Window as any)({
    gdkmonitor,
    exclusivity: Astal.Exclusivity.IGNORE,
    layer:       Astal.Layer.OVERLAY,
    anchor:      BOTTOM | RIGHT,
    margin_bottom: 50,
    margin_right:  7,
    keymode:     Astal.Keymode.ON_DEMAND,
    application: app,
  })
  const unregisterFlyout = registerFlyout()
  cls(win, 'WifiMenuWindow')
  ;(function() {
    const screen = win.get_screen()
    const visual = screen?.get_rgba_visual()
    if (visual) win.set_visual(visual)
  })()

  let revealer: Gtk.Revealer | null = null

  const close = () => {
    if (closed) return; closed = true
    scanGeneration++
    if (listRebuildId != null) { GLib.source_remove(listRebuildId); listRebuildId = null }
    if (scanRefreshId != null) { GLib.source_remove(scanRefreshId); scanRefreshId = null }
    unregisterFlyout()
    if (revealer) revealer.set_reveal_child(false)
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
      try { win.destroy() } catch (_) {}
      return GLib.SOURCE_REMOVE
    })
  }
  trackEscapeDismiss(win, close)

  win.connect('key-press-event', (_: any, e: any) => {
    const [, k] = e.get_keyval()
    if (k === Gdk.KEY_Escape) close()
    return false
  })
  win.connect('destroy', () => {
    closed = true
    scanGeneration++
    if (listRebuildId != null) { GLib.source_remove(listRebuildId); listRebuildId = null }
    if (scanRefreshId != null) { GLib.source_remove(scanRefreshId); scanRefreshId = null }
    unregisterFlyout()
    unregisterNetworkLayout()
  })

  const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
  cls(root, 'wifi-menu-root', 'wifi-menu-wifi')
  if (managedLayout) cls(root, 'network-flyout-managed')
  revealer = new Gtk.Revealer({
    transition_type: Gtk.RevealerTransitionType.CROSSFADE,
    transition_duration: 120,
    visible: true,
    reveal_child: false,
  })
  revealer.add(root)
  win.add(revealer)

  const hdr    = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, visible: true })
  cls(hdr, 'wifi-menu-header')
  const hdrIco = iconImage('wifi', IC.accent, 17)
  const hdrLbl = new Gtk.Label({ label: 'Wi-Fi', visible: true, xalign: 0, hexpand: true })
  cls(hdrLbl, 'wifi-menu-title')
  const scanBtn = mkIconBtn('refresh', 'Rescan')
  hdr.add(hdrIco); hdr.add(hdrLbl); hdr.add(scanBtn)
  root.add(hdr)
  root.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const [errorToast, toastError] = makeErrorToast()
  const showError = (msg: string, opts?: { silent?: boolean }) => {
    toastError(msg)
    if (!opts?.silent) { try { derr('[WiFi]', msg) } catch (_) {} }
  }
  root.add(errorToast)

  const bwRow = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 12,
    visible: true,
    hexpand: true,
  })
  cls(bwRow, 'wifi-bw-row')
  const bwRx = new Gtk.Label({ label: '↓ –', visible: true }); cls(bwRx, 'wifi-bw-val')
  const bwTx = new Gtk.Label({ label: '↑ –', visible: true }); cls(bwTx, 'wifi-bw-val')
  bwRx.set_hexpand(true); bwRx.set_xalign(0)
  bwTx.set_xalign(1)
  bwRow.add(bwRx); bwRow.add(bwTx)
  root.add(bwRow)
  root.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  let bwPrevRx = 0, bwPrevTx = 0, bwPrevTime = Date.now()
  const pollBw = () => {
    const pif = getPrimaryIface()
    if (!pif) { bwRx.set_label('↓ –'); bwTx.set_label('↑ –'); return }
    const b = getIfaceBytes(pif)
    if (!b) return
    const now = Date.now()
    const dt  = (now - bwPrevTime) / 1000
    if (dt > 0.3 && bwPrevRx > 0) {
      const rx = Math.max(0, b.rx - bwPrevRx) / dt
      const tx = Math.max(0, b.tx - bwPrevTx) / dt
      bwRx.set_label(`↓ ${fmtSpeed(rx)}/s`)
      bwTx.set_label(`↑ ${fmtSpeed(tx)}/s`)
    }
    bwPrevRx = b.rx; bwPrevTx = b.tx; bwPrevTime = now
  }
  pollBw()
  const bwId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, clampInterval(1500), () => { pollBw(); return GLib.SOURCE_CONTINUE })
  win.connect('destroy', () => { try { GLib.source_remove(bwId) } catch (_) {} })

  const geo = gdkmonitor.get_geometry()
  const menuH = Math.min(600, Math.max(220, geo.height - 70))
  const scroll = new Gtk.ScrolledWindow({ visible: true })
  scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  scroll.set_max_content_height(Math.max(140, menuH - 155))
  scroll.set_propagate_natural_height(true)
  const menuW = networkFlyoutWidth(gdkmonitor, managedLayout)
  scroll.set_min_content_width(menuW)
  scroll.set_max_content_width(menuW)
  scroll.set_vexpand(true)

  const listBox = new Gtk.ListBox({ visible: true, selection_mode: Gtk.SelectionMode.NONE })
  cls(listBox, 'wifi-ap-list')
  scroll.add(listBox)
  const listOverlay = new Gtk.Overlay({ visible: true })
  listOverlay.add(scroll)
  root.add(listOverlay)

  listBox.connect('row-activated', (_: any, row: any) => {
    const i = row.get_index()
    if (i < 0 || i >= apRefs.length) return
    const ssid = apRefs[i].ssid
    expandedSsid = expandedSsid === ssid ? null : ssid
    if (listRebuildId != null) return
    listRebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      listRebuildId = null
      if (!closed) buildApList(visibleAps)
      return GLib.SOURCE_REMOVE
    })
  })

  const buildDetail = (ap: WifiAP): Gtk.Box => {
    const panel = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, visible: false })
    cls(panel, 'wifi-detail-panel')
    panel.connect('button-press-event', () => true)

    if (ap.active) {
      const btn = new Gtk.Button({ label: '󱘖  Disconnect', visible: true, hexpand: true, halign: Gtk.Align.FILL })
      cls(btn, 'wifi-disconnect-btn')
      btn.connect('clicked', () => {
        execAsync(['iwctl', 'station', iface, 'disconnect'])
          .catch(e => showError("Disconnect failed: " + (e?.message || e)))
        close()
      })
      panel.add(btn)
    } else {
      const isOpen = !ap.security || ap.security === '--'
      const isKnown = knownNets.has(ap.ssid)
      let passEntry: Gtk.Entry | null = null

      if (!isOpen) {
        passEntry = new Gtk.Entry({ visible: true, hexpand: true })
        passEntry.set_visibility(false)
        passEntry.set_placeholder_text(isKnown ? 'Saved network — password optional' : 'Password…')
        passEntry.set_input_purpose(Gtk.InputPurpose.PASSWORD)
        panel.add(passEntry)
      }

      const btn = new Gtk.Button({ label: '󰤨  Connect', visible: true, hexpand: true, halign: Gtk.Align.FILL })
      cls(btn, 'wifi-connect-btn')
      const doConnect = () => {
        const pass = passEntry?.get_text?.() ?? ''
        if (!isOpen && !pass && !isKnown) {
          showError('Enter the network password.', { silent: true })
          passEntry?.grab_focus()
          return
        }
        if (/EAP|802\.1X/i.test(ap.security)) {
          showError('Enterprise iwd networks need a username/certificate flow not configured in this widget.', { silent: true })
          return
        }
        scanGeneration++
        if (scanRefreshId != null) { GLib.source_remove(scanRefreshId); scanRefreshId = null }
        btn.set_sensitive(false)
        btn.set_label('Connecting…')
        connectIwd(iface, ap.ssid, isOpen ? '' : pass, false)
          .then(() => { knownNets.add(ap.ssid); close() })
          .catch((e: any) => {
            if (!isOpen && !pass && isKnown) {
              showError('Saved password rejected — type it manually.', { silent: true })
              showError("Connection failed: " + (e?.message || e))
              passEntry?.grab_focus()
            } else {
              showError("Connection failed: " + (e?.message || e))
            }
            btn.set_sensitive(true)
            btn.set_label('󰤨  Connect')
          })
      }
      btn.connect('clicked', doConnect)
      passEntry?.connect('activate', doConnect)
      panel.add(btn)
    }

    return panel
  }

  const buildApList = (aps: WifiAP[]) => {
    visibleAps = [...aps]
    listBox.get_children().forEach((c: Gtk.Widget) => c.destroy())
    detailPanels.length = 0
    apRefs.length = 0

    const orderedAps = [...aps].sort((a, b) => {
      const aSelected = a.ssid === expandedSsid
      const bSelected = b.ssid === expandedSsid
      if (aSelected !== bSelected) return aSelected ? -1 : 1
      if (a.active !== b.active) return a.active ? -1 : 1
      if (a.signal !== b.signal) return b.signal - a.signal
      return a.ssid.localeCompare(b.ssid)
    })

    if (orderedAps.length === 0) {
      expandedSsid = null
      const empty = new Gtk.Label({ label: 'No networks found', visible: true })
      cls(empty, 'wifi-empty-label')
      empty.set_margin_top(10); empty.set_margin_bottom(10)
      const row = new Gtk.ListBoxRow({ visible: true, activatable: false })
      row.add(empty)
      listBox.add(row)
      return
    }

    for (const ap of orderedAps) {
      apRefs.push(ap)
      const wrapper = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })

      const line = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true, hexpand: true })
      cls(line, 'wifi-ap-row')
      if (ap.active) cls(line, 'wifi-ap-active')

      const sigIco = iconImage(sigName(ap.signal), ap.active ? IC.accent : IC.secondary, 16)
      sigIco.set_valign(Gtk.Align.CENTER)
      const text = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 1,
        visible: true,
        hexpand: true,
      })
      const name   = new Gtk.Label({ label: ap.ssid || '(hidden)', visible: true, xalign: 0, hexpand: true })
      cls(name, 'wifi-ap-name'); name.set_ellipsize(3); name.set_max_width_chars(24)
      const security = secShort(ap.security)
      const status = new Gtk.Label({
        label: ap.active ? `Connected · ${security}` : security,
        visible: true,
        xalign: 0,
        hexpand: true,
      })
      cls(status, 'wifi-ap-status')
      status.set_ellipsize(3)
      status.set_single_line_mode(true)
      text.add(name)
      text.add(status)

      line.add(sigIco); line.add(text)
      if (ap.security && ap.security !== '--') {
        const lock = new Gtk.Label({ label: '󰌾', visible: true, valign: Gtk.Align.CENTER })
        cls(lock, 'wifi-lock-icon')
        line.add(lock)
      }

      wrapper.add(line)
      const detail = buildDetail(ap)
      wrapper.add(detail)
      detailPanels.push(detail)

      const row = new Gtk.ListBoxRow({ visible: true, activatable: true })
      row.add(wrapper)
      listBox.add(row)
    }

    if (expandedSsid) {
      const i = apRefs.findIndex(ap => ap.ssid === expandedSsid)
      if (i >= 0) detailPanels[i].set_visible(true)
      else expandedSsid = null
    }
    if (expandedSsid) {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try { scroll.get_vadjustment().set_value(0) } catch (_) {}
        return GLib.SOURCE_REMOVE
      })
    }
  }

  const footer = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
  cls(footer, 'wifi-menu-footer')
  footer.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const hiddenToggle = new Gtk.Button({ label: '  Connect to hidden network…', visible: true, hexpand: true, halign: Gtk.Align.FILL })
  try { (hiddenToggle.get_child() as any)?.set_xalign?.(0) } catch (_) {}
  cls(hiddenToggle, 'wifi-hidden-toggle')

  const hiddenPanel = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, visible: true })
  cls(hiddenPanel, 'wifi-detail-panel')
  hiddenPanel.set_margin_start(10); hiddenPanel.set_margin_end(10); hiddenPanel.set_margin_bottom(8)

  const hiddenRevealer = new Gtk.Revealer({
    visible: true,
    transition_type: Gtk.RevealerTransitionType.SLIDE_UP,
    transition_duration: 220,
    reveal_child: false,
  })
  hiddenRevealer.add(hiddenPanel)

  const hiddenGroup = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
  cls(hiddenGroup, 'wifi-hidden-group')
  hiddenGroup.add(hiddenToggle)
  hiddenGroup.add(hiddenRevealer)
  hiddenGroup.set_halign(Gtk.Align.FILL)
  hiddenGroup.set_valign(Gtk.Align.END)
  listOverlay.add_overlay(hiddenGroup)

  const hSsidRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
  const hSsidLbl = new Gtk.Label({ label: 'SSID', visible: true, xalign: 1.0 }); cls(hSsidLbl, 'wifi-info-key')
  const hSsidE   = new Gtk.Entry({ visible: true, hexpand: true })
  hSsidE.set_placeholder_text('Network name…')
  hSsidRow.add(hSsidLbl); hSsidRow.add(hSsidE)

  const hPassRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
  const hPassLbl = new Gtk.Label({ label: 'Password', visible: true, xalign: 1.0 }); cls(hPassLbl, 'wifi-info-key')
  const hPassE   = new Gtk.Entry({ visible: true, hexpand: true })
  hPassE.set_visibility(false)
  hPassE.set_placeholder_text('Empty if open…')
  hPassE.set_input_purpose(Gtk.InputPurpose.PASSWORD)
  hPassRow.add(hPassLbl); hPassRow.add(hPassE)

  const hConnBtn = new Gtk.Button({ label: '󰤨  Connect', visible: true, hexpand: true, halign: Gtk.Align.FILL })
  cls(hConnBtn, 'wifi-connect-btn')
  const doHidden = () => {
    const ssid = hSsidE.get_text().trim()
    const pass = hPassE.get_text()
    if (!ssid) return
    hConnBtn.set_sensitive(false)
    hConnBtn.set_label('Connecting…')
    connectIwd(iface, ssid, pass, true)
      .then(() => close())
      .catch((e: any) => {
        showError("Connection failed: " + (e?.message || e))
        hConnBtn.set_sensitive(true)
        hConnBtn.set_label('󰤨  Connect')
      })
  }
  hConnBtn.connect('clicked', doHidden)
  hPassE.connect('activate', doHidden)
  hiddenPanel.add(hSsidRow); hiddenPanel.add(hPassRow); hiddenPanel.add(hConnBtn)
  root.pack_end(footer, false, false, 0)

  let hiddenOpen = false
  hiddenToggle.connect('clicked', () => {
    hiddenOpen = !hiddenOpen
    hiddenRevealer.set_reveal_child(hiddenOpen)
    hiddenToggle.set_label(hiddenOpen ? '  ▲ Cancel' : '  Connect to hidden network…')
    try { (hiddenToggle.get_child() as any)?.set_xalign?.(0) } catch (_) {}
  })

  let listLoadGeneration = 0
  const loadList = () => {
    const generation = ++listLoadGeneration

    fetchKnownNetworks().then(set => {
      if (!closed && generation === listLoadGeneration) knownNets = set
    })
    execAsync(['iwctl', 'station', iface, 'get-networks'])
      .then((raw: string) => {
        if (closed || generation !== listLoadGeneration) return
        buildApList(parseIwctlNetworks(raw))
      })
      .catch(() => {
        if (!closed && generation === listLoadGeneration) buildApList([])
      })
  }

  const doRescan = (reportErrors = false, attempt = 0) => {
    const generation = ++scanGeneration
    hdrLbl.set_label('Scanning…')
    requestWifiScan(iface)
      .catch((error: unknown) => {
        if (closed || generation !== scanGeneration) return
        // Retry once: transient driver hiccup
        if (attempt < 1) {
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (!closed && generation === scanGeneration) doRescan(reportErrors, attempt + 1)
            return GLib.SOURCE_REMOVE
          })
          return
        }
        if (!reportErrors) return
        const detail = (error instanceof Error ? error.message : String(error ?? '')).trim()
        showError(detail
          ? `Scan failed (${iface}): ${detail}`
          : `Scan failed on ${iface}: iwctl gave no details (see journalctl -u iwd)`)
      })
      .then(() => {
        if (closed || generation !== scanGeneration) return
        if (scanRefreshId != null) GLib.source_remove(scanRefreshId)
        scanRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
          scanRefreshId = null
          if (!closed && generation === scanGeneration) { loadList(); hdrLbl.set_label('Wi-Fi') }
          return GLib.SOURCE_REMOVE
        })
      })
  }

  scanBtn.connect('clicked', () => doRescan(true))

  loadList()
  doRescan(false)

  win.set_size_request(menuW, menuH)
  const networkLayout = managedLayout
    ? registerNetworkFlyout('wifi', win, gdkmonitor, menuW + 2)
    : { unregister: () => {}, revealDelayMs: 30 }
  unregisterNetworkLayout = networkLayout.unregister
  win.show_all()
  detailPanels.forEach(d => d.set_visible(false))
  hiddenRevealer.set_reveal_child(false)
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, networkLayout.revealDelayMs, () => {
    if (!closed && revealer) revealer.set_reveal_child(true)
    return GLib.SOURCE_REMOVE
  })

  return close
}
