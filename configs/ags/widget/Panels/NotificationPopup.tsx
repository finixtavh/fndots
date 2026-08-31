// Notification Popup
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import GLib from "gi://GLib"
import AstalNotifd from "gi://AstalNotifd"
import { createState, createEffect, onCleanup } from "ags"
import { buildNotifItem, isDndEnabled } from "./NotificationCenter"

const notifd = AstalNotifd.get_default()

interface Toast { id: number; n: any; timer: number | null }

const DEFAULT_TIMEOUT  = 5000
const CRITICAL_TIMEOUT = 8000

export default function NotificationPopup(gdkmonitor: Gdk.Monitor) {
  let win: Astal.Window

  const [toasts, setToasts] = createState<Toast[]>([])

  const remove = (id: number, cancelTimer = true) => {
    setToasts(prev => {
      const t = prev.find(t => t.id === id)
      if (cancelTimer && t?.timer != null) GLib.source_remove(t.timer)
      return prev.filter(t => t.id !== id)
    })
  }

  const push = (n: any) => {
    if (isDndEnabled()) return
    remove(n.id)

    const urgency = n.urgency ?? 1
    const critical = urgency === 2
    const timeout = n.expireTimeout > 0 ? n.expireTimeout : (critical ? CRITICAL_TIMEOUT : DEFAULT_TIMEOUT)

    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeout, () => {
      remove(n.id, false)
      return GLib.SOURCE_REMOVE
    })
    setToasts(prev => [...prev, { id: n.id, n, timer }])
  }

  let notifiedId: number | null = null
  let resolvedId: number | null = null
  try {
    notifiedId = notifd.connect('notified', (_src: any, id: number) => {
      try {
        const n = notifd.get_notification(id)
        if (n) push(n)
      } catch (_) {}
    })
  } catch (_) {}

  try {
    resolvedId = notifd.connect('resolved', (_src: any, id: number) => remove(id))
  } catch (_) {}

  onCleanup(() => {
    try { if (notifiedId != null) notifd.disconnect(notifiedId) } catch (_) {}
    try { if (resolvedId != null) notifd.disconnect(resolvedId) } catch (_) {}
    toasts().forEach(t => { if (t.timer != null) GLib.source_remove(t.timer) })
    try { win?.destroy() } catch (_) {}
  })

  const { TOP, RIGHT } = Astal.WindowAnchor

  return (
    <window
      $={(self: any) => (win = self)}
      visible={toasts.as((t: Toast[]) => t.length > 0)}
      class="NotifPopup"
      namespace="ags-notif-popup"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.IGNORE}
      layer={Astal.Layer.OVERLAY}
      anchor={TOP | RIGHT}
      marginTop={60}
      marginRight={8}
      keymode={Astal.Keymode.NONE}
      application={app}
    >
      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        halign={Gtk.Align.END}
        $={(self: any) => {
          createEffect(() => {
            const list = toasts()
            self.get_children().forEach((c: any) => c.destroy())
            list.forEach((t: Toast) => {
              const item = buildNotifItem(t.n, () => remove(t.id))
              item.get_style_context().add_class('notif-toast')
              self.add(item)
            })
            self.show_all()
          })
        }}
      />
    </window>
  )
}
