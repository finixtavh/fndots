// Command Center
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import { iconImage, IC } from "../Helpers/Icons"
import { derr } from "../Helpers/DashLog"
import { AGS_CONFIG_DIR, HYPR_CONFIG_DIR } from "../Helpers/Paths"
import { loadSettings, saveSettings } from "../Helpers/UserSettings"
import { trackEscapeDismiss } from "../Helpers/FlyoutState"

const AGS_LAUNCHER = GLib.build_filenamev([AGS_CONFIG_DIR, 'scripts', 'launch-ags.sh'])
const HYPRSUNSET_APPLY = GLib.build_filenamev([
  HYPR_CONFIG_DIR, 'scripts', 'hyprland', 'apply-hyprsunset.sh',
])

const ACTIONS = [
  {
    icon:    'refresh',
    label:   'Restart Bar',
    argv:    ['bash', '-c', 'ags quit -i ags-bar; sleep 0.3; nohup "$1" >/dev/null 2>&1 &', 'restart-bar', AGS_LAUNCHER],
    isPower: false,
  },
  {
    icon:  'dashboard',
    label: 'Dashboard',
    argv:  ['ags', 'toggle', '-i', 'ags-bar', 'dashboard'],
    isPower: false,
  },
  {
    icon:    'power',
    label:   'Power',
    argv:    ['ags', 'toggle', '-i', 'ags-bar', 'power-menu'],
    isPower: true,
  },
  {
    icon:    'cog',
    label:   'Settings',
    argv:    ['ags', 'toggle', '-i', 'ags-bar', 'cava-settings'],
    isPower: false,
  },
]

export default function CommandCenter() {
  let win: Astal.Window
  const CENTER = Astal.WindowAnchor.NONE
  let nightEnabled = loadSettings().hyprsunsetEnabled === true
  const nightLabel = new Gtk.Label({ visible: true, xalign: 0, hexpand: true })
  const nightState = new Gtk.Label({ visible: true })
  const syncNight = () => {
    nightLabel.set_label('Night light')
    nightState.set_label(nightEnabled ? 'On · 4000 K' : 'Off')
  }
  syncNight()

  const close = () => {
    try { win?.set_visible(false) } catch (_) {}
  }

  return (
    <window
      $={(self: any) => {
        win = self
        trackEscapeDismiss(self, close)
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
      name="command-center"
      class="CommandCenter"
      visible={false}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={CENTER}
      exclusivity={Astal.Exclusivity.IGNORE}
      layer={Astal.Layer.OVERLAY}
      application={app}
      onKeyPressEvent={(_: any, event: any) => {
        const [, k] = event.get_keyval()
        if (k === Gdk.KEY_Escape) close()
      }}
    >
      <revealer
        transitionType={Gtk.RevealerTransitionType.CROSSFADE}
        revealChild={false}
      >
      <box class="cmd-root" orientation={Gtk.Orientation.VERTICAL} spacing={0}>
        <box class="cmd-header" spacing={8}>
          {iconImage('dashboard', IC.accent, 17)}
          <label class="cmd-title" label="Command Center" xalign={0} />
        </box>
        {new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true })}

        <box class="cmd-body" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
          <box class="cmd-actions" spacing={8} halign={Gtk.Align.CENTER}>
            {ACTIONS.map(({ icon, label, argv, isPower }) => (
              <button
                class={isPower ? 'cmd-btn cmd-btn-power' : 'cmd-btn'}
                tooltip_text={label}
                onClicked={() => {
                  close()
                  execAsync(argv).catch(e => derr('[CommandCenter]', e))
                }}
              >
                <box orientation={Gtk.Orientation.VERTICAL} spacing={8}
                  halign={Gtk.Align.CENTER}
                  valign={Gtk.Align.CENTER}
                >
                  {iconImage(icon, isPower ? '#f87171' : IC.accent, 28)}
                  <label class="cmd-btn-label" label={label} halign={Gtk.Align.CENTER} />
                </box>
              </button>
            ))}
          </box>

          <button
            class="cmd-toggle-row"
            onClicked={() => {
              nightEnabled = !nightEnabled
              saveSettings({ hyprsunsetEnabled: nightEnabled })
              syncNight()
              execAsync([HYPRSUNSET_APPLY]).catch(e => derr('[CommandCenter]', e))
            }}
          >
            <box spacing={8}>
              {iconImage('w-sunny', IC.accent, 18)}
              {nightLabel}
              {nightState}
            </box>
          </button>

          <label class="cmd-hint" label="Press Esc to close" halign={Gtk.Align.CENTER} />
        </box>
      </box>
      </revealer>
    </window>
  )
}
