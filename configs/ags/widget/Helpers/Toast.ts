// Toast
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk3"

const cls = (w: Gtk.Widget, c: string) => { w.set_name(c); (w as any).get_style_context?.().add_class(c) }

export function makeErrorToast(): [Gtk.Revealer, (msg: string) => void] {
  let timeoutId = 0
  let destroyed = false

  const lbl = new Gtk.Label({ visible: true, xalign: 0, wrap: true, max_width_chars: 60 })
  cls(lbl, 'error-toast-label')

  const box = new Gtk.Box({ visible: true })
  cls(box, 'error-toast')
  box.add(lbl)

  const rev = new Gtk.Revealer({
    transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
    visible: true,
    reveal_child: false,
  })
  rev.add(box)

  rev.connect('destroy', () => {
    destroyed = true
    if (timeoutId) {
      GLib.source_remove(timeoutId)
      timeoutId = 0
    }
  })

  const show = (msg: string) => {
    if (destroyed) return
    if (timeoutId) { GLib.source_remove(timeoutId); timeoutId = 0 }
    lbl.set_label(msg)
    rev.set_reveal_child(true)
    timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
      if (!destroyed) rev.set_reveal_child(false)
      timeoutId = 0
      return GLib.SOURCE_REMOVE
    })
  }

  return [rev, show]
}
