// Bluetooth Menu
import Gtk from "gi://Gtk?version=3.0"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import AstalBluetooth from "gi://AstalBluetooth?version=0.1"
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

Gio._promisify(
  AstalBluetooth.Device.prototype,
  'connect_device',
  'connect_device_finish',
)
Gio._promisify(
  AstalBluetooth.Device.prototype,
  'disconnect_device',
  'disconnect_device_finish',
)

function devTypeName(iconName: string): string {
  const n = (iconName || '').toLowerCase()
  if (n.includes('headset') || n.includes('headphone')) return 'headset'
  if (n.includes('audio') || n.includes('speaker'))      return 'headset'
  if (n.includes('mouse'))                                return 'mouse'
  if (n.includes('keyboard'))                             return 'keyboard'
  if (n.includes('phone'))                                return 'phone'
  if (n.includes('watch'))                                return 'watch'
  if (n.includes('gaming') || n.includes('joystick'))     return 'controller'
  if (n.includes('printer'))                              return 'printer'
  if (n.includes('computer'))                             return 'computer'
  return 'bt'
}

function cls(w: Gtk.Widget, ...names: string[]) {
  const ctx = w.get_style_context()
  names.forEach(n => ctx.add_class(n))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mkIconBtn(icon: string, tip: string): Gtk.Button {
  const b = new Gtk.Button({ visible: true, tooltip_text: tip })
  b.add(iconImage(icon, IC.secondary, 15))
  cls(b, 'wifi-icon-btn')
  return b
}

export function openBluetoothMenu(gdkmonitor: Gdk.Monitor): () => void {
  const bluezAvailable = GLib.file_test('/usr/lib/bluetooth/bluetoothd', GLib.FileTest.IS_EXECUTABLE)
    || GLib.find_program_in_path('bluetoothd') !== null
  if (!bluezAvailable) return () => {}

  let closed = false
  let expandedAddr: string | null = null
  const detailPanels: Gtk.Widget[] = []
  const devRefs: AstalBluetooth.Device[] = []
  const busyAddresses = new Set<string>()
  const managedLayout = networkFlyoutLayoutEnabled()
  let unregisterNetworkLayout = () => {}

  const bt = AstalBluetooth.Bluetooth.get_default()

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
  const sigIds: number[] = []
  const deviceSigIds = new Map<AstalBluetooth.Device, number[]>()
  let refreshSourceId: number | null = null
  let listRebuildId: number | null = null
  let scanStopId: number | null = null
  let discoveryStartedHere = false
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try {
      if (discoveryStartedHere && bt.adapter?.discovering) bt.adapter.stop_discovery()
    } catch (_) {}
    discoveryStartedHere = false
    sigIds.forEach(id => { try { bt.disconnect(id) } catch (_) {} })
    sigIds.length = 0
    deviceSigIds.forEach((ids, dev) => {
      ids.forEach(id => { try { dev.disconnect(id) } catch (_) {} })
    })
    deviceSigIds.clear()
    if (refreshSourceId != null) { GLib.source_remove(refreshSourceId); refreshSourceId = null }
    if (listRebuildId != null) { GLib.source_remove(listRebuildId); listRebuildId = null }
    if (scanStopId != null) { GLib.source_remove(scanStopId); scanStopId = null }
  }

  const close = () => {
    if (closed) return; closed = true
    unregisterFlyout()
    cleanup()
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
    unregisterFlyout()
    unregisterNetworkLayout()
    cleanup()
  })

  const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
  cls(root, 'wifi-menu-root')
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
  const hdrIco = iconImage('bt', IC.accent, 17)
  const hdrLbl = new Gtk.Label({ label: 'Bluetooth', visible: true, xalign: 0, hexpand: true })
  cls(hdrLbl, 'wifi-menu-title')
  const powerBtn = mkIconBtn('power', 'Toggle adapter')
  const scanBtn  = mkIconBtn('refresh', 'Scan for devices')
  hdr.add(hdrIco); hdr.add(hdrLbl); hdr.add(powerBtn); hdr.add(scanBtn)
  root.add(hdr)
  root.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const [errorToast, toastError] = makeErrorToast()
  const showError = (msg: string, opts?: { silent?: boolean }) => {
    toastError(msg)
    if (!opts?.silent) { try { derr('[Bluetooth]', msg) } catch (_) {} }
  }
  root.add(errorToast)

  const scroll = new Gtk.ScrolledWindow({ visible: true })
  scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  const geo = gdkmonitor.get_geometry()
  const menuH = Math.min(600, Math.max(240, geo.height - 70))
  scroll.set_max_content_height(Math.max(160, menuH - 70))
  scroll.set_propagate_natural_height(true)
  const menuW = networkFlyoutWidth(gdkmonitor, managedLayout)
  scroll.set_min_content_width(menuW)
  scroll.set_max_content_width(menuW)
  scroll.set_vexpand(false)

  const listBox = new Gtk.ListBox({ visible: true, selection_mode: Gtk.SelectionMode.NONE })
  cls(listBox, 'wifi-ap-list')
  scroll.add(listBox)
  root.add(scroll)

  listBox.connect('row-activated', (_: any, row: any) => {
    const i = row.get_index()
    if (i < 0 || i >= devRefs.length) return
    const address = devRefs[i].address
    expandedAddr = expandedAddr === address ? null : address
    if (listRebuildId != null) return
    listRebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      listRebuildId = null
      if (!closed) buildList()
      return GLib.SOURCE_REMOVE
    })
  })

  const buildDetail = (dev: AstalBluetooth.Device): Gtk.Box => {
    const panel = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, visible: false })
    cls(panel, 'wifi-detail-panel')
    panel.connect('button-press-event', () => true)

    const grid = new Gtk.Grid({ visible: true, column_spacing: 10, row_spacing: 3 })
    grid.set_margin_bottom(4)
    let rowIdx = 0
    const addRow = (k: string, v: string, sel = false) => {
      const kl = new Gtk.Label({ label: k, visible: true, xalign: 0 }); cls(kl, 'wifi-info-key')
      const vl = new Gtk.Label({ label: v, visible: true, xalign: 1, hexpand: true }); cls(vl, 'wifi-info-val')
      if (sel) vl.set_selectable(true)
      grid.attach(kl, 0, rowIdx, 1, 1)
      grid.attach(vl, 1, rowIdx, 1, 1)
      rowIdx++
    }
    const trustRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
    const trustLbl = new Gtk.Label({ label: 'Trusted', visible: true, xalign: 0, hexpand: true }); cls(trustLbl, 'wifi-info-key')
    const trustSw  = new Gtk.Switch({ visible: true, active: dev.trusted, valign: Gtk.Align.CENTER })
    cls(trustSw, 'settings-switch')
    trustSw.connect('state-set', (_: any, state: boolean) => {
      try { dev.trusted = state }
      catch (error) { if (!closed) showError('Trust update failed: ' + errorMessage(error)) }
      return false
    })
    trustRow.add(trustLbl); trustRow.add(trustSw)
    panel.add(trustRow)
    if ((dev.battery_percentage ?? -1) >= 0) {
      addRow('Battery', `${Math.round(dev.battery_percentage * 100)}%`)
      panel.add(grid)
    }

    const btnRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })

    if (dev.connected) {
      const discBtn = new Gtk.Button({ label: '󱘖  Disconnect', visible: true })
      cls(discBtn, 'wifi-disconnect-btn')
      discBtn.connect('clicked', () => {
        discBtn.set_sensitive(false)
        discBtn.set_label('󰤠  Disconnecting…')
        void disconnectDevice(dev)
      })
      btnRow.add(discBtn)
    } else {
      const connecting = busyAddresses.has(dev.address) || dev.connecting
      const connBtn = new Gtk.Button({
        label: connecting ? '󰂯  Connecting…' : '󰂯  ' + (dev.paired ? 'Connect' : 'Pair & Connect'),
        visible: true,
        sensitive: !connecting,
      })
      cls(connBtn, 'wifi-connect-btn')
      connBtn.connect('clicked', () => {
        connBtn.set_sensitive(false)
        connBtn.set_label('󰂯  Connecting…')
        void connectDevice(dev)
      })
      btnRow.add(connBtn)
    }

    if (dev.paired) {
      const forgetBtn = new Gtk.Button({ label: '󰆴  Forget', visible: true })
      cls(forgetBtn, 'wifi-action-btn')
      forgetBtn.connect('clicked', () => {
        try { bt.adapter?.remove_device(dev) }
        catch (e) { showError("Failed to remove device: " + errorMessage(e)) }
      })
      btnRow.add(forgetBtn)
    }

    panel.add(btnRow)
    return panel
  }

  const buildList = () => {
    listBox.get_children().forEach((c: Gtk.Widget) => c.destroy())
    detailPanels.length = 0
    devRefs.length = 0

    const devices = [...bt.devices].sort((a, b) => {
      if (a.address === expandedAddr) return -2
      if (b.address === expandedAddr) return 2
      if (a.connected !== b.connected) return a.connected ? -1 : 1
      if (a.paired !== b.paired)       return a.paired ? -1 : 1
      return (a.alias || a.name || '').localeCompare(b.alias || b.name || '')
    })

    if (devices.length === 0) {
      const empty = new Gtk.Label({ label: 'No devices found', visible: true })
      cls(empty, 'wifi-empty-label')
      empty.set_margin_top(10); empty.set_margin_bottom(10)
      const row = new Gtk.ListBoxRow({ visible: true, activatable: false })
      row.add(empty)
      listBox.add(row)
      return
    }

    for (const dev of devices) {
      devRefs.push(dev)
      const wrapper = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })

      const line = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true, hexpand: true })
      cls(line, 'wifi-ap-row')
      if (dev.connected) cls(line, 'wifi-ap-active')

      const typeIco = iconImage(devTypeName(dev.icon), dev.connected ? IC.accent : IC.secondary, 16)
      typeIco.set_valign(Gtk.Align.CENTER)
      const text = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 1,
        visible: true,
        hexpand: true,
      })
      const name    = new Gtk.Label({ label: dev.alias || dev.name || dev.address, visible: true, xalign: 0, hexpand: true })
      cls(name, 'wifi-ap-name'); name.set_ellipsize(3); name.set_max_width_chars(19)
      const battery = dev.connected && (dev.battery_percentage ?? -1) >= 0
        ? ` · ${Math.round(dev.battery_percentage * 100)}%`
        : ''
      const status = new Gtk.Label({
        label: `${dev.connected ? 'Connected' : dev.paired ? 'Paired' : 'New'}${battery}`,
        visible: true,
        xalign: 0,
        hexpand: true,
      })
      cls(status, 'wifi-ap-status')
      status.set_ellipsize(3)
      status.set_single_line_mode(true)
      text.add(name)
      text.add(status)

      line.add(typeIco); line.add(text)
      if (dev.paired) {
        const lock = new Gtk.Label({ label: '󰌾', visible: true, valign: Gtk.Align.CENTER })
        cls(lock, 'wifi-lock-icon')
        line.add(lock)
      }

      wrapper.add(line)
      const detail = buildDetail(dev)
      wrapper.add(detail)
      detailPanels.push(detail)

      const row = new Gtk.ListBoxRow({ visible: true, activatable: true })
      row.add(wrapper)
      listBox.add(row)
    }

    if (expandedAddr) {
      const i = devRefs.findIndex(d => d.address === expandedAddr)
      if (i >= 0) detailPanels[i].set_visible(true)
      else expandedAddr = null
    }
    if (expandedAddr) {
      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        try { scroll.get_vadjustment().set_value(0) } catch (_) {}
        return GLib.SOURCE_REMOVE
      })
    }
  }

  const updatePowerBtn = () => {
    const on = bt.adapter?.powered ?? bt.isPowered ?? false
    powerBtn.set_label(on ? '󰐥' : '󰐦')
    powerBtn.set_tooltip_text(on ? 'Turn Bluetooth off' : 'Turn Bluetooth on')
  }
  powerBtn.connect('clicked', () => {
    try { bt.toggle() } catch (_) {}
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
      if (!closed) updatePowerBtn()
      return GLib.SOURCE_REMOVE
    })
  })

  let scanning = false
  const stopScan = () => {
    const adapter = bt.adapter
    try { if (adapter && discoveryStartedHere && adapter.discovering) adapter.stop_discovery() } catch (_) {}
    discoveryStartedHere = false
    scanning = false
    hdrLbl.set_label('Bluetooth')
    if (scanStopId != null) { GLib.source_remove(scanStopId); scanStopId = null }
  }
  const startScan = () => {
    const adapter = bt.adapter
    if (!adapter || scanning || !adapter.powered) return
    try {
      if (!adapter.discovering) {
        adapter.start_discovery()
        discoveryStartedHere = true
      }
      scanning = true
      hdrLbl.set_label('Scanning…')
      scanStopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8000, () => {
        scanStopId = null
        if (closed) return GLib.SOURCE_REMOVE
        stopScan()
        return GLib.SOURCE_REMOVE
      })
    } catch (error) {
      stopScan()
      showError('Scan failed: ' + errorMessage(error))
    }
  }
  scanBtn.connect('clicked', () => {
    if (scanning) stopScan()
    else startScan()
  })

  const repairAndConnect = async (address: string) => {
    await execAsync(['bluetoothctl', 'pair', address])
    await execAsync(['bluetoothctl', 'trust', address]).catch(() => {})
    await execAsync(['bluetoothctl', 'connect', address])
  }

  const isAgentError = (message: string): boolean =>
    /agent|authenticat|authoriz|confirm|pin|passkey|pairing.*(reject|abort|cancel)/i.test(message)

  const showConnectError = (message: string) => {
    if (isAgentError(message)) {
      showError('Pairing needs confirmation on the device — pair from system Bluetooth settings, then Connect.')
    } else {
      showError("Connection failed: " + message)
    }
  }

  const connectDevice = async (dev: AstalBluetooth.Device) => {
    const address = dev.address
    if (busyAddresses.has(address) || dev.connecting) return
    const wasPaired = dev.paired

    busyAddresses.add(address)

    try {
      const adapter = bt.adapter
      if (adapter?.discovering) {
        try { adapter.stop_discovery() } catch (_) {}
        discoveryStartedHere = false
        scanning = false
        if (scanStopId != null) { GLib.source_remove(scanStopId); scanStopId = null }
        hdrLbl.set_label('Bluetooth')
      }

      if (wasPaired) {
        await dev.connect_device()
        try { dev.trusted = true } catch (_) {}
      } else {
        await repairAndConnect(address)
      }
    } catch (e: unknown) {
      const message = errorMessage(e)
      if (closed) return
      if (/br-connection-key-missing|key.*missing|missing.*key/i.test(message)) {
        showError('Pairing key missing — forgetting device and reconnecting…')
        try { bt.adapter?.remove_device(dev) } catch (_) {}
        try { await execAsync(['bluetoothctl', 'remove', address]) } catch (_) {}
        try {
          await repairAndConnect(address)
        } catch (retryError: unknown) {
          if (!closed) showConnectError(errorMessage(retryError))
        }
      } else {
        showConnectError(message)
      }
    } finally {
      busyAddresses.delete(address)
      queueRefresh(true)
    }
  }

  const disconnectDevice = async (dev: AstalBluetooth.Device) => {
    const address = dev.address
    if (busyAddresses.has(address)) return
    busyAddresses.add(address)
    try {
      await dev.disconnect_device()
    } catch (error) {
      if (!closed) showError('Disconnect failed: ' + errorMessage(error))
    } finally {
      busyAddresses.delete(address)
      queueRefresh(true)
    }
  }

  const deviceSignature = () => JSON.stringify(
    [...bt.devices]
      .map(dev => [
        dev.address,
        dev.alias,
        dev.name,
        dev.icon,
        dev.connected,
        dev.connecting,
        dev.paired,
        dev.battery_percentage,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
  let lastDeviceSignature = ''
  const refresh = (force = false) => {
    if (closed) return
    const signature = deviceSignature()
    if (!force && signature === lastDeviceSignature) return
    lastDeviceSignature = signature
    buildList()
  }

  let queuedRefreshForced = false
  const queueRefresh = (force = false) => {
    queuedRefreshForced ||= force
    if (closed || busyAddresses.size > 0 || refreshSourceId != null) return
    refreshSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
      refreshSourceId = null
      const shouldForce = queuedRefreshForced
      queuedRefreshForced = false
      refresh(shouldForce)
      return GLib.SOURCE_REMOVE
    })
  }

  const syncDeviceSignals = () => {
    const devices = new Set([...bt.devices])
    deviceSigIds.forEach((ids, dev) => {
      if (devices.has(dev)) return
      ids.forEach(id => { try { dev.disconnect(id) } catch (_) {} })
      deviceSigIds.delete(dev)
    })
    devices.forEach(dev => {
      if (deviceSigIds.has(dev)) return
      const ids = [
        dev.connect('notify::connected', () => queueRefresh()),
        dev.connect('notify::connecting', () => queueRefresh()),
        dev.connect('notify::paired', () => queueRefresh()),
        dev.connect('notify::trusted', () => queueRefresh()),
        dev.connect('notify::battery-percentage', () => queueRefresh()),
        dev.connect('notify::alias', () => queueRefresh()),
      ]
      deviceSigIds.set(dev, ids)
    })
  }

  sigIds.push(bt.connect('device-added', () => {
    syncDeviceSignals()
    queueRefresh(true)
  }))
  sigIds.push(bt.connect('device-removed', () => {
    syncDeviceSignals()
    queueRefresh(true)
  }))

  syncDeviceSignals()
  updatePowerBtn()
  refresh(true)
  startScan()

  win.set_size_request(menuW, menuH)
  const networkLayout = managedLayout
    ? registerNetworkFlyout('bluetooth', win, gdkmonitor, menuW + 2)
    : { unregister: () => {}, revealDelayMs: 30 }
  unregisterNetworkLayout = networkLayout.unregister
  win.show_all()
  detailPanels.forEach(d => d.set_visible(false))
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, networkLayout.revealDelayMs, () => {
    if (!closed && revealer) revealer.set_reveal_child(true)
    return GLib.SOURCE_REMOVE
  })

  return close
}
