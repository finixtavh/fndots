// Power Menu
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import { execAsync } from "ags/process"
import { createState } from "ags"
import GLib from "gi://GLib"
import { iconImage, IconImg, IC } from "../Helpers/Icons"
import { derr } from "../Helpers/DashLog"
import { trackEscapeDismiss } from "../Helpers/FlyoutState"
import { HYPR_CONFIG_DIR } from "../Helpers/Paths"

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`
const SESSION_SAVE = `${shellQuote(GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'fnsession']))} save`
const LOCK_SCRIPT = GLib.build_filenamev([HYPR_CONFIG_DIR, 'scripts', 'hyprlock', 'launch.sh'])

interface PendingAction {
  cmd:   string
  label: string
  icon:  string
}

export default function PowerMenu() {
  const CENTER = Astal.WindowAnchor.NONE
  const [pending, setPending] = createState<PendingAction | null>(null)

  const closeMenu = () => {
    setPending(null)
    app.get_window("power-menu")?.set_visible(false)
  }

  const run = (cmd: string) => {
    execAsync(['bash', '-c', cmd]).catch(e => derr('[PowerMenu]', e))
    closeMenu()
  }

  const askConfirm = (action: PendingAction) => setPending(action)

  return (
    <window
      name="power-menu"
      class="PowerMenu"
      namespace="power-menu"
      visible={false}
      keymode={Astal.Keymode.EXCLUSIVE}
      anchor={CENTER}
      exclusivity={Astal.Exclusivity.IGNORE}
      application={app}
      $={(self: any) => {
        trackEscapeDismiss(self, closeMenu)
        ;(function() {
          const screen = self.get_screen()
          const visual = screen?.get_rgba_visual()
          if (visual) self.set_visual(visual)
        })()
        self.connect('notify::visible', () => {
          if (!self.get_visible()) return
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            const ch = self.get_children()[0] as any
            if (ch) ch.set_reveal_child(true)
            return GLib.SOURCE_REMOVE
          })
        })
      }}
      onKeyPressEvent={(self: any, event: any) => {
          const [, keyval] = event.get_keyval()
        if (keyval === Gdk.KEY_Escape) {
          if (pending()) setPending(null)
          else self.set_visible(false)
        }
      }}
    >
      <revealer
        transitionType={Gtk.RevealerTransitionType.CROSSFADE}
        revealChild={false}
      >
      <box class="power-menu-root" orientation={Gtk.Orientation.VERTICAL} spacing={0}>
        <box class="power-menu-header" orientation={Gtk.Orientation.HORIZONTAL} spacing={8}>
          {iconImage('power', IC.accent, 17)}
          <label class="power-menu-title" label="Session" />
        </box>
        {new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true })}
        <box class="power-menu-content" orientation={Gtk.Orientation.VERTICAL} spacing={15}>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={15}
          visible={pending.as((p: PendingAction | null) => p === null)}
        >
          <box class="power-menu-buttons" spacing={8}>

            <button class="power-btn shutdown"
              onClicked={() => askConfirm({ cmd: `${SESSION_SAVE} && systemctl poweroff`, label: "shut down the system", icon: "power" })}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={5} valign={Gtk.Align.CENTER}>
                {iconImage('power', IC.accent, 26)}
                <label class="power-label" label="Shutdown" />
              </box>
            </button>

            <button class="power-btn reboot"
              onClicked={() => askConfirm({ cmd: `${SESSION_SAVE} && systemctl reboot`, label: "restart the system", icon: "refresh" })}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={5} valign={Gtk.Align.CENTER}>
                {iconImage('refresh', IC.accent, 26)}
                <label class="power-label" label="Restart" />
              </box>
            </button>

            <button class="power-btn suspend" onClicked={() => run("systemctl suspend")}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={5} valign={Gtk.Align.CENTER}>
                {iconImage('sleep', IC.accent, 26)}
                <label class="power-label" label="Suspend" />
              </box>
            </button>

            <button class="power-btn lock" onClicked={() => run(shellQuote(LOCK_SCRIPT))}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={5} valign={Gtk.Align.CENTER}>
                {iconImage('lock', IC.accent, 26)}
                <label class="power-label" label="Lock" />
              </box>
            </button>

            <button class="power-btn logout"
              onClicked={() => askConfirm({ cmd: `${SESSION_SAVE} && hyprctl dispatch 'hl.dsp.exit()' ''`, label: "log out", icon: "logout" })}>
              <box orientation={Gtk.Orientation.VERTICAL} spacing={5} valign={Gtk.Align.CENTER}>
                {iconImage('logout', IC.accent, 26)}
                <label class="power-label" label="Log out" />
              </box>
            </button>

          </box>
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={15}
          visible={pending.as((p: PendingAction | null) => p !== null)}
        >
          <box halign={Gtk.Align.CENTER}>
            {IconImg(pending.as((p: PendingAction | null) => p?.icon ?? "power") as any, IC.accent, 38)}
          </box>
          <label class="power-confirm-text"
            label={pending.as((p: PendingAction | null) => p ? `Are you sure you want to ${p.label}?` : "")} />
          <box class="power-confirm-buttons" spacing={10} halign={Gtk.Align.CENTER}>
            <button class="power-confirm-btn cancel" onClicked={() => setPending(null)}>
              <label label="Cancel" />
            </button>
            <button class="power-confirm-btn confirm" onClicked={() => { const p = pending(); if (p) run(p.cmd) }}>
              <label label="Confirm" />
            </button>
          </box>
        </box>

        </box>
      </box>
      </revealer>
    </window>
  )
}
