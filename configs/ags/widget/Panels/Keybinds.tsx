// Keybinds
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import GLib from "gi://GLib"
import { placeWindowAtPointer } from "../Helpers/Monitor"
import { HYPR_CONFIG_DIR } from "../Helpers/Paths"
import { trackEscapeDismiss } from "../Helpers/FlyoutState"
import { iconImage, IC } from "../Helpers/Icons"

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any
    }
  }
}

interface KB { keys: string; tokens: string[]; action: string; section: string }

function tok(keys: string): string[] {
  return keys.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean)
}

const MOD_ICONS: Record<string, string> = { SUPER: 'super', CTRL: 'ctrl', ALT: 'alt', SHIFT: 'shift' }

const CATEGORY_MAP: Record<string, string> = {
  'Apps':                      'Aplicaciones',
  'Shell / Launcher':          'Sistema',
  'Windows':                   'Ventanas',
  'Focus':                     'Ventanas',
  'Move Window':               'Ventanas',
  'Positioning':                'Ventanas',
  'Split ratio':                'Ventanas',
  'Mouse Binds':                'Ventanas',
  'Workspaces (1 to 10)':       'Workspaces',
  'Workspace Navigation':       'Workspaces',
  'Scroll Workspace':           'Workspaces',
  'Scroll Move Window':         'Workspaces',
  'Scratchpad':                  'Workspaces',
  'Screenshots & Utilities':    'Utilidades',
  'Multimedia':                  'Multimedia',
  'Playerctl Media Controls':   'Multimedia',
  'Session / Zoom':             'Sistema',
}
const CATEGORY_ORDER = ['Aplicaciones', 'Ventanas', 'Workspaces', 'Multimedia', 'Utilidades', 'Sistema']

const COMMON: KB[] = [
  { keys: 'SUPER + Enter',      tokens: tok('SUPER + Enter'),      action: 'Terminal (Kitty)',    section: 'common' },
  { keys: 'SUPER + W',          tokens: tok('SUPER + W'),          action: 'Firefox',             section: 'common' },
  { keys: 'SUPER + E',          tokens: tok('SUPER + E'),          action: 'File Manager',        section: 'common' },
  { keys: 'SUPER + C',          tokens: tok('SUPER + C'),          action: 'Command Center',      section: 'common' },
  { keys: "SUPER + '",          tokens: tok("SUPER + '"),          action: 'Keybind Viewer',      section: 'common' },
  { keys: 'SUPER + Q',          tokens: tok('SUPER + Q'),          action: 'Close Window',        section: 'common' },
  { keys: 'SUPER + F',          tokens: tok('SUPER + F'),          action: 'Fullscreen Toggle',   section: 'common' },
  { keys: 'SUPER + D',          tokens: tok('SUPER + D'),          action: 'Maximize Toggle',     section: 'common' },
  { keys: 'SUPER + L',          tokens: tok('SUPER + L'),          action: 'Lock Screen',         section: 'common' },
  { keys: 'SUPER + SHIFT + S',  tokens: tok('SUPER + SHIFT + S'),  action: 'Screenshot Region',   section: 'common' },
  { keys: 'SUPER + V',          tokens: tok('SUPER + V'),          action: 'Dashboard (Clipboard)', section: 'common' },
  { keys: 'SUPER + Period',     tokens: tok('SUPER + Period'),     action: 'Emoji Picker',        section: 'common' },
]

const _dec = new TextDecoder()

function humanize(cmd: string): string {
  const c = cmd.trim()
  if (c === 'kitty')                                      return 'Terminal (Kitty)'
  if (c.includes('rofi-toggle'))                          return 'App Launcher Toggle'
  if (c.startsWith('rofi'))                               return 'App Launcher'
  if (c === 'firefox')                                    return 'Firefox'
  if (c === 'thunar')                                     return 'File Manager'
  if (c === 'code')                                       return 'VS Code'
  if (c === 'kate')                                       return 'Kate'
  if (c.includes('gnome-control'))                        return 'Control Center'
  if (c.includes('gnome-system-monitor'))                 return 'System Monitor'
  if (c.includes('systemctl suspend'))                    return 'Suspend'
  if (c.includes('systemctl poweroff'))                   return 'Shutdown'
  if (c.includes('systemctl reboot'))                     return 'Reboot'
  if (c.includes('hyprctl dispatch exit'))                return 'Logout'
  if (c.includes('hyprlock'))                             return 'Lock Screen'
  if (c.includes('hyprctl kill'))                         return 'Kill Window (Pick)'
  if (c.includes('hyprpicker'))                           return 'Color Picker'
  if (c.includes('screenshot') && c.includes('region'))  return 'Screenshot Region'
  if (c.includes('screenshot') && c.includes('screen'))  return 'Screenshot Screen'
  if (c.includes('screenshot'))                           return 'Screenshot'
  if (c.includes('clipboard'))                            return 'Clipboard'
  if (c.includes('emoji'))                                return 'Emoji Picker'
  if (c.includes('wallpaper'))                            return 'Random Wallpaper'
  if (c.includes('powermenu'))                            return 'Power Menu'
  if (c.includes('ags toggle') && c.includes('command-center'))  return 'Command Center'
  if (c.includes('ags toggle') && c.includes('power-menu'))      return 'Power Menu'
  if (c.includes('ags toggle') && c.includes('keybinds'))        return 'Keybind Viewer'
  if (c.includes('ags toggle') && c.includes('dashboard'))       return 'Dashboard'
  if (c.includes('wpctl set-mute') && c.includes('SINK'))        return 'Toggle Audio Mute'
  if (c.includes('wpctl set-mute') && c.includes('SOURCE'))      return 'Toggle Mic Mute'
  if (c.includes('wpctl set-volume') && c.includes('%+'))        return 'Volume Up'
  if (c.includes('wpctl set-volume') && c.includes('%-'))        return 'Volume Down'
  if (c.includes('playerctl next'))                       return 'Next Track'
  if (c.includes('playerctl previous'))                   return 'Previous Track'
  if (c.includes('playerctl play-pause'))                 return 'Play / Pause'
  if (c.includes('brightnessctl') && c.includes('+'))    return 'Brightness Up'
  if (c.includes('brightnessctl') && c.includes('-'))    return 'Brightness Down'
  if (c.includes('dunstctl'))                             return 'Notification History'
  if (c.includes('cyclenext'))                            return 'Cycle Windows'
  if (c.includes('keybinds-viewer'))                      return 'Keybind Viewer'
  if (c.includes('zoom_factor') && c.includes('+ 0.3')) return 'Zoom In'
  if (c.includes('zoom_factor') && c.includes('- 0.3')) return 'Zoom Out'
  if (c.includes('pavucontrol'))                          return 'Audio Mixer'
  if (c.includes('XF86PowerOff') || c.includes('power-menu')) return 'Power Menu'
  return c.length > 38 ? c.slice(0, 36) + '…' : c
}

function parseKeybinds(): KB[] {
  const res: KB[] = []
  try {
    const [ok, raw] = GLib.file_get_contents(GLib.build_filenamev([HYPR_CONFIG_DIR, 'keybinds.lua']))
    if (!ok) return res
    const lines = _dec.decode(raw).split('\n')
    let section = 'General'
    let inLoop = false

    for (const line of lines) {
      const t = line.trim()
      if (t.startsWith('for ') && t.includes(' do')) { inLoop = true; continue }
      if (t === 'end')                                { inLoop = false; continue }
      if (inLoop) continue

      const secM = t.match(/^--\s*[─\-]+\s*(.+?)\s*[─\-]+\s*$/)
      if (secM) { section = secM[1].trim(); continue }

      if (!t.startsWith('hl.bind(') && !t.startsWith('restricted_bind(')) continue

      const keyM = t.match(/^(?:hl\.bind|restricted_bind)\(([^,]+),/)
      if (!keyM) continue

      const rawKey = keyM[1]
      if (rawKey.includes('tostring')) continue

      const tokens = rawKey
        .split('..')
        .map(part => {
          const p = part.trim()
          if (/^mainMod$/.test(p)) return 'SUPER'
          const m = p.match(/^["'](.*)["']$/)
          return (m ? m[1] : p).trim()
            .replace(/SUPER_L/g, 'SUPER')
            .replace(/Super_L/g, 'SUPER')
        })
        .filter(Boolean)
        .join(' ')
        .split(/\s*\+\s*/)
        .map(s => s.trim())
        .filter(Boolean)
      if (!tokens.length) continue
      const keys = tokens.join(' + ')

      if (/[{}()\[\].]/.test(keys)) continue

      let action = ''
      const execM = t.match(/exec_cmd\("([^"]+)"\)/)
      if (execM) {
        action = humanize(execM[1])
      } else if (t.includes('window.close()'))                                    { action = 'Close Window'
      } else if (t.includes('window.fullscreen') && t.includes('maximized'))      { action = 'Maximize Toggle'
      } else if (t.includes('window.fullscreen'))                                  { action = 'Fullscreen Toggle'
      } else if (t.includes('window.float'))                                       { action = 'Float Toggle'
      } else if (t.includes('window.pin()'))                                       { action = 'Pin Window'
      } else if (t.includes('window.drag()'))                                      { action = 'Drag Window'
      } else if (t.includes('window.resize()'))                                    { action = 'Resize Window'
      } else if (t.includes('window.move') && t.includes('workspace'))             { action = 'Move to Workspace'
      } else if (t.includes('window.move'))                                        { action = 'Move Window'
      } else if (t.includes('workspace.toggle_special'))                           { action = 'Toggle Scratchpad'
      } else if (t.includes('layout("splitratio') && t.includes('-'))              { action = 'Shrink Split'
      } else if (t.includes('layout("splitratio') && t.includes('+'))              { action = 'Grow Split'
      } else if (t.includes('focus({ direction')) {
        const d = t.match(/direction\s*=\s*"(\w+)"/)?.[1] ?? ''
        const dm: Record<string, string> = { l: 'Left', r: 'Right', u: 'Up', d: 'Down' }
        action = `Focus ${dm[d] ?? d}`
      } else if (t.includes('focus({ workspace')) {
        const ws = t.match(/workspace\s*=\s*"([^"]+)"/)?.[1] ?? ''
        if (ws === 'r+1') action = 'Next Workspace'
        else if (ws === 'r-1') action = 'Previous Workspace'
        else action = `Workspace ${ws}`
      }

      if (action) res.push({ keys, tokens, action, section })
    }
  } catch (_) {}
  return res
}

function buildKeysBox(tokens: string[], minWidth: number): Gtk.Box {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 4, visible: true })
  const contentW = tokens.reduce((w, token, i) => {
    const sep = i > 0 ? 14 : 0 // '+' label + spacing
    return w + sep + (MOD_ICONS[token.toUpperCase()] ? 18 : token.length * 9 + 16)
  }, 8)
  box.set_size_request(Math.max(minWidth, contentW), -1)
  tokens.forEach((token, i) => {
    if (i > 0) {
      const plus = new Gtk.Label({ label: '+', visible: true })
      plus.get_style_context().add_class('kb-plus')
      box.add(plus)
    }
    const iconName = MOD_ICONS[token.toUpperCase()]
    if (iconName) {
      box.add(iconImage(iconName, IC.accent, 14))
    } else {
      const kl = new Gtk.Label({ label: token, visible: true })
      kl.get_style_context().add_class('kb-key')
      box.add(kl)
    }
  })
  return box
}

export default function Keybinds() {
  let win: Astal.Window
  let firstMap = true
  let buildContent = () => {}
  let rootWidget: Gtk.Widget | null = null
  const CENTER = Astal.WindowAnchor.NONE
  const close = () => { try { win?.set_visible(false) } catch (_) {} }
  const fitToPointerMonitor = () => {
    const geo = placeWindowAtPointer(win)
    rootWidget?.set_size_request(Math.max(320, Math.min(660, geo.width - 32)), -1)
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
        self.connect('map', () => { if (firstMap) { firstMap = false; buildContent() } })
        self.connect('notify::visible', () => {
          if (!self.get_visible()) return
          fitToPointerMonitor()
          GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            const ch = self.get_children()[0] as any
            if (ch) ch.set_reveal_child(true)
            return GLib.SOURCE_REMOVE
          })
        })
      }}
      name="keybinds-viewer"
      class="KeybindsViewer"
      visible={false}
      keymode={Astal.Keymode.EXCLUSIVE}
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
      <box class="kb-root" orientation={Gtk.Orientation.VERTICAL} spacing={12}
        $={(self: any) => {
          rootWidget = self
          fitToPointerMonitor()
          buildContent = () => {
          const allBinds = parseKeybinds()

          const entry = new Gtk.SearchEntry({ visible: true })
          entry.get_style_context().add_class('kb-search')
          entry.set_placeholder_text('Search keybinds…')
          entry.set_hexpand(true)
          self.add(entry)

          const comTitle = new Gtk.Label({ label: 'COMMON', visible: true, xalign: 0 })
          comTitle.get_style_context().add_class('kb-section-title')
          self.add(comTitle)

          const grid = new Gtk.Grid({ visible: true, column_spacing: 28, row_spacing: 3 })
          grid.get_style_context().add_class('kb-common-grid')
          COMMON.forEach(({ tokens, action }, i) => {
            const col = (i % 2) * 2
            const row = Math.floor(i / 2)
            const kb = buildKeysBox(tokens, 220)
            const al = new Gtk.Label({ label: action, visible: true, xalign: 0 })
            al.get_style_context().add_class('kb-action')
            grid.attach(kb, col,     row, 1, 1)
            grid.attach(al, col + 1, row, 1, 1)
          })
          self.add(grid)

          const sep = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true })
          self.add(sep)

          const allTitle = new Gtk.Label({ label: 'ALL KEYBINDS', visible: true, xalign: 0 })
          allTitle.get_style_context().add_class('kb-section-title')
          self.add(allTitle)

          const scroll = new Gtk.ScrolledWindow({ visible: true })
          scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
          scroll.set_min_content_height(200)
          scroll.set_max_content_height(360)
          self.add(scroll)

          const allBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, visible: true })
          scroll.add(allBox)

          const grouped = new Map<string, KB[]>()
          allBinds.forEach(kb => {
            const cat = CATEGORY_MAP[kb.section] ?? kb.section
            if (!grouped.has(cat)) grouped.set(cat, [])
            grouped.get(cat)!.push(kb)
          })
          const orderedCats = [
            ...CATEGORY_ORDER.filter(c => grouped.has(c)),
            ...[...grouped.keys()].filter(c => !CATEGORY_ORDER.includes(c)),
          ]

          type Row = { keyLow: string; actLow: string; row: Gtk.ListBoxRow }
          type Group = { box: Gtk.Box; rows: Row[] }
          const groups: Group[] = []

          for (const cat of orderedCats) {
            const catBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, visible: true })

            const catTitle = new Gtk.Label({ label: cat.toUpperCase(), visible: true, xalign: 0 })
            catTitle.get_style_context().add_class('kb-group-title')
            catBox.add(catTitle)

            const listBox = new Gtk.ListBox({ visible: true, selection_mode: Gtk.SelectionMode.NONE })
            listBox.get_style_context().add_class('kb-list')
            catBox.add(listBox)

            const rows: Row[] = grouped.get(cat)!.map(({ keys, tokens, action }) => {
              const row = new Gtk.ListBoxRow({ visible: true })
              row.get_style_context().add_class('kb-row')
              const hbox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 20, visible: true,
                margin_start: 8, margin_end: 8,
                margin_top: 3, margin_bottom: 3,
              })
              const kb = buildKeysBox(tokens, 260)
              const sep = new Gtk.Label({ label: '//', visible: true })
              sep.get_style_context().add_class('kb-sep')
              const al = new Gtk.Label({ label: action, visible: true, xalign: 0 })
              al.get_style_context().add_class('kb-action')
              al.set_hexpand(true)
              hbox.add(kb); hbox.add(sep); hbox.add(al)
              row.add(hbox)
              listBox.add(row)
              return { keyLow: keys.toLowerCase(), actLow: action.toLowerCase(), row }
            })

            groups.push({ box: catBox, rows })
            allBox.add(catBox)
          }

          entry.connect('search-changed', () => {
            const q = entry.get_text().toLowerCase().trim()
            groups.forEach(({ box, rows }) => {
              let anyVisible = false
              rows.forEach(({ keyLow, actLow, row }) => {
                const vis = !q || keyLow.includes(q) || actLow.includes(q)
                row.set_visible(vis)
                if (vis) anyVisible = true
              })
              box.set_visible(anyVisible)
            })
          })

          const hint = new Gtk.Label({ label: 'Esc to close', visible: true })
          hint.get_style_context().add_class('kb-hint')
          self.add(hint)

          self.show_all()

          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const topWin = self.get_toplevel?.() ?? win
            if (topWin) topWin.connect('show', () => {
              entry.set_text('')
              groups.forEach(({ box, rows }) => {
                rows.forEach(({ row }) => row.set_visible(true))
                box.set_visible(true)
              })
              entry.grab_focus()
            })
            return GLib.SOURCE_REMOVE
          })
          }
        }}
      />
      </revealer>
    </window>
  )
}
