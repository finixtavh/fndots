// Notification Center
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import AstalNotifd from "gi://AstalNotifd"
import GdkPixbuf from "gi://GdkPixbuf"
import { createState, createEffect, onCleanup } from "ags"
import { iconImage, IC } from "../Helpers/Icons"
import { derr } from "../Helpers/DashLog"
import { AGS_CONFIG_DIR, HYPR_CONFIG_DIR } from "../Helpers/Paths"
import { loadSettings, saveSettings } from "../Helpers/UserSettings"
import { trackEscapeDismiss } from "../Helpers/FlyoutState"

const AGS_LAUNCHER = GLib.build_filenamev([AGS_CONFIG_DIR, 'scripts', 'launch-ags.sh'])
const HYPRSUNSET_APPLY = GLib.build_filenamev([
  HYPR_CONFIG_DIR, 'scripts', 'hyprland', 'apply-hyprsunset.sh',
])

const notifd = AstalNotifd.get_default()

let _dndEnabled: boolean = false
try { _dndEnabled = !!(notifd as any).dontDisturb } catch (_) {}
const _dndSubs: Set<() => void> = new Set()

export function isDndEnabled(): boolean { return _dndEnabled }
export function subscribeDnd(cb: () => void): () => void {
  _dndSubs.add(cb); return () => _dndSubs.delete(cb)
}
function _publishDnd(val: boolean) {
  if (_dndEnabled === val) return
  _dndEnabled = val
  _dndSubs.forEach(cb => { try { cb() } catch (_) {} })
}
function _applyDnd(val: boolean) {
  try { (notifd as any).dontDisturb = val } catch (_) {}
  _publishDnd(val)
}

try {
  notifd.connect('notify::dont-disturb', () => {
    try { _publishDnd(!!(notifd as any).dontDisturb) } catch (_) {}
  })
} catch (_) {}

const _togglers = new Map<Gdk.Monitor, () => void>()
export function toggleNotifCenter(monitor: Gdk.Monitor) {
  _togglers.get(monitor)?.()
}

function timeAgo(epoch: number): string {
  const diff = Math.floor(Date.now() / 1000) - epoch
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function buildNotifItem(n: any, onDismiss: () => void): Gtk.Box {
  const urgency = n.urgency ?? 1

  const item = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL, spacing: 10,
    visible: true, margin_start: 2, margin_end: 2,
  })
  item.get_style_context().add_class('notif-item')
  item.get_style_context().add_class(`urgency-${urgency}`)

  const iconBox = new Gtk.Box({ visible: true, valign: Gtk.Align.START })
  iconBox.get_style_context().add_class('notif-icon-box')
  try {
    if (n.image) {
      const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(n.image, 32, 32, true)
      const img = new Gtk.Image({ visible: true })
      img.set_from_pixbuf(pb)
      iconBox.add(img)
    } else {
      const appIcon = n.appIcon ?? n.app_icon ?? ''
      const img = new Gtk.Image({ visible: true })
      img.set_from_icon_name(appIcon || 'dialog-information-symbolic', Gtk.IconSize.DND)
      img.set_pixel_size(32)
      iconBox.add(img)
    }
  } catch (_) {
    const img = new Gtk.Image({ visible: true })
    img.set_from_icon_name('dialog-information-symbolic', Gtk.IconSize.DND)
    img.set_pixel_size(32)
    iconBox.add(img)
  }
  item.add(iconBox)

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL, spacing: 2,
    visible: true, hexpand: true, valign: Gtk.Align.START,
  })

  const headerRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, visible: true })

  const appLbl = new Gtk.Label({
    label: n.appName ?? n.app_name ?? '',
    visible: true, xalign: 0,
  })
  appLbl.get_style_context().add_class('notif-app')
  headerRow.add(appLbl)

  const timeLbl = new Gtk.Label({
    label: timeAgo(n.time ?? 0),
    visible: true, xalign: 1, hexpand: true,
  })
  timeLbl.get_style_context().add_class('notif-time')
  headerRow.add(timeLbl)
  content.add(headerRow)

  if (n.summary) {
    const summaryLbl = new Gtk.Label({
      label: n.summary,
      visible: true, xalign: 0,
    })
    summaryLbl.get_style_context().add_class('notif-summary')
    summaryLbl.set_ellipsize(3)
    summaryLbl.set_max_width_chars(34)
    content.add(summaryLbl)
  }

  if (n.body) {
    const bodyLbl = new Gtk.Label({
      label: n.body,
      visible: true, xalign: 0,
    })
    bodyLbl.get_style_context().add_class('notif-body')
    bodyLbl.set_line_wrap(true)
    bodyLbl.set_max_width_chars(34)
    bodyLbl.set_ellipsize(3)
    content.add(bodyLbl)
  }

  item.add(content)

  const dismissBtn = new Gtk.Button({ visible: true, valign: Gtk.Align.CENTER })
  dismissBtn.get_style_context().add_class('notif-dismiss')
  dismissBtn.add(iconImage('close', IC.dim, 11))
  dismissBtn.connect('clicked', () => {
    try { n.dismiss?.() } catch (_) {}
    onDismiss()
  })
  item.add(dismissBtn)

  return item
}

export default function NotificationCenter(gdkmonitor: Gdk.Monitor) {
  let win: Astal.Window
  const { TOP, RIGHT } = Astal.WindowAnchor
  // BAR_HEIGHT (50, ver OSD.tsx) + 5px de gap sobre la MainBar
  const PANEL_BOTTOM_GAP = 55

  const [notifs, setNotifs] = createState<any[]>([])

  const refresh = () => {
    try {
      const ns = notifd.get_notifications?.() ?? []
      setNotifs([...ns].reverse())
    } catch (_) { setNotifs([]) }
  }

  let notifiedId: number | null = null
  let resolvedId: number | null = null
  try { notifiedId = notifd.connect('notified', () => refresh()) } catch (_) {}
  try { resolvedId = notifd.connect('resolved', () => refresh()) } catch (_) {}
  refresh()

  _togglers.set(gdkmonitor, () => {
    try { if (win) win.set_visible(!win.get_visible()) } catch (_) {}
  })
  onCleanup(() => {
    _togglers.delete(gdkmonitor)
    try { if (notifiedId != null) notifd.disconnect(notifiedId) } catch (_) {}
    try { if (resolvedId != null) notifd.disconnect(resolvedId) } catch (_) {}
    try { win?.destroy() } catch (_) {}
  })

  return (
    <window
      $={(self: any) => {
        win = self
        trackEscapeDismiss(self, () => self.set_visible(false))
        self.connect('notify::visible', () => {
          if (!self.get_visible()) {
            const ch = self.get_children()[0] as any
            if (ch) ch.set_reveal_child(false)
            return
          }
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            const ch = self.get_children()[0] as any
            if (ch) ch.set_reveal_child(true)
            return GLib.SOURCE_REMOVE
          })
        })
      }}
      visible={false}
      name="notif-center"
      class="NotifCenter"
      namespace="ags-notif-center"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.IGNORE}
      layer={Astal.Layer.OVERLAY}
      anchor={TOP | RIGHT}
      marginTop={0}
      marginRight={0}
      keymode={Astal.Keymode.ON_DEMAND}
      application={app}
    >
      <revealer
        transitionType={Gtk.RevealerTransitionType.CROSSFADE}
        revealChild={false}
      >
      <box class="notif-panel" orientation={Gtk.Orientation.VERTICAL} spacing={0}
        $={(self: any) => {

          const headerOuter = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 6,
            visible: true, margin_start: 14, margin_end: 14,
            margin_top: 12, margin_bottom: 8,
          })

          const titleRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
          const titleIco = iconImage('bell', IC.accent, 16)
          const titleLbl = new Gtk.Label({ label: 'Notifications', visible: true, xalign: 0, hexpand: true })
          titleLbl.get_style_context().add_class('notif-panel-title')
          titleRow.add(titleIco); titleRow.add(titleLbl)
          const clearBtn = new Gtk.Button({ visible: true })
          clearBtn.get_style_context().add_class('notif-clear-btn')
          clearBtn.add(new Gtk.Label({ label: 'Clear', visible: true }))
          clearBtn.connect('clicked', () => {
            try {
              notifd.get_notifications?.()?.forEach((n: any) => {
                try { n.dismiss?.() } catch (_) {}
              })
            } catch (_) {}
            refresh()
          })
          titleRow.add(clearBtn)
          headerOuter.add(titleRow)

          const dndRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
          const dndLbl = new Gtk.Label({ label: 'Do Not Disturb', visible: true, xalign: 0, hexpand: true })
          dndLbl.get_style_context().add_class('notif-dnd-label')
          dndRow.add(dndLbl)
          const dndSwitch = new Gtk.Switch({ visible: true })
          dndSwitch.set_active(_dndEnabled)
          dndSwitch.connect('state-set', (_sw: any, state: boolean) => {
            _applyDnd(state)
            return false
          })
          dndRow.add(dndSwitch)
          headerOuter.add(dndRow)

          self.add(headerOuter)

          const sep = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true })
          self.add(sep)

          const scroll = new Gtk.ScrolledWindow({ visible: true })
          scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
          const panelH = Math.max(220, gdkmonitor.get_geometry().height - PANEL_BOTTOM_GAP)
          scroll.set_min_content_height(panelH)
          scroll.set_max_content_height(panelH)
          self.add(scroll)

          const list = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 4,
            visible: true,
            margin_start: 10, margin_end: 10,
            margin_top: 25, margin_bottom: 8,
          })
          scroll.add(list)

          const emptyLbl = new Gtk.Label({
            label: 'No notifications',
            visible: true, xalign: 0.5,
          })
          emptyLbl.get_style_context().add_class('notif-empty')

          createEffect(() => {
            const ns = notifs()

            list.get_children().forEach((c: any) => { if (c === emptyLbl) list.remove(c); else c.destroy() })

            if (ns.length === 0) {
              list.add(emptyLbl)
            } else {
              ns.forEach((n: any) => {
                const item = buildNotifItem(n, refresh)
                list.add(item)
              })
            }
            list.show_all()
          })

          const sep2 = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true })
          self.add(sep2)

          const actionsOuter = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 10,
            visible: true, margin_start: 14, margin_end: 14,
            margin_top: 10, margin_bottom: 8,
          })
          const actionsTitle = new Gtk.Label({ label: 'Quick Actions', visible: true, xalign: 0 })
          actionsTitle.get_style_context().add_class('notif-actions-title')
          actionsOuter.add(actionsTitle)

          const grid = new Gtk.Grid({ visible: true, column_spacing: 8, row_spacing: 8, hexpand: true })
          grid.set_column_homogeneous(true)
          actionsOuter.add(grid)

          const runAction = (argv: string[]) => {
            execAsync(argv).catch(e => derr('[NotificationCenter]', e))
          }
          const mkActionBtn = (icon: string, label: string, isPower: boolean, onClicked: () => void) => {
            const btn = new Gtk.Button({ visible: true, tooltip_text: label })
            btn.get_style_context().add_class('notif-action-btn')
            if (isPower) btn.get_style_context().add_class('notif-action-power')
            const inner = new Gtk.Box({
              orientation: Gtk.Orientation.VERTICAL, spacing: 6, visible: true,
              halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER,
            })
            inner.add(iconImage(icon, isPower ? '#f87171' : IC.accent, 28))
            const lbl = new Gtk.Label({ label, visible: true, halign: Gtk.Align.CENTER })
            lbl.get_style_context().add_class('notif-action-label')
            inner.add(lbl)
            btn.add(inner)
            btn.connect('clicked', onClicked)
            return btn
          }

          let nightEnabled = loadSettings().hyprsunsetEnabled === true
          let nightBtn: Gtk.Button | null = null
          const syncNightBtn = () => {
            if (!nightBtn) return
            const ctx = nightBtn.get_style_context()
            if (nightEnabled) ctx.add_class('notif-action-active')
            else ctx.remove_class('notif-action-active')
            nightBtn.set_tooltip_text(nightEnabled ? 'Night Light — On · 4000 K' : 'Night Light — Off')
          }

          grid.attach(mkActionBtn('refresh', 'Restart Bar', false, () => {
            runAction(['bash', '-c', 'ags quit -i ags-bar; sleep 0.3; nohup "$1" >/dev/null 2>&1 &', 'restart-bar', AGS_LAUNCHER])
          }), 0, 0, 1, 1)
          grid.attach(mkActionBtn('dashboard', 'Dashboard', false, () => {
            runAction(['ags', 'toggle', '-i', 'ags-bar', 'dashboard'])
          }), 1, 0, 1, 1)
          grid.attach(mkActionBtn('power', 'Power', true, () => {
            runAction(['ags', 'toggle', '-i', 'ags-bar', 'power-menu'])
          }), 2, 0, 1, 1)
          grid.attach(mkActionBtn('cog', 'Settings', false, () => {
            runAction(['ags', 'toggle', '-i', 'ags-bar', 'cava-settings'])
          }), 3, 0, 1, 1)
          nightBtn = mkActionBtn('w-sunny', 'Night Light', false, () => {
            nightEnabled = !nightEnabled
            saveSettings({ hyprsunsetEnabled: nightEnabled })
            syncNightBtn()
            runAction([HYPRSUNSET_APPLY])
          })
          grid.attach(nightBtn, 0, 1, 1, 1)
          syncNightBtn()

          self.add(actionsOuter)

          self.show_all()
        }}
      />
      </revealer>
    </window>
  )
}
