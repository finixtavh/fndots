// Settings Panel
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import { dwarn } from "../Helpers/DashLog"
import GLib from "gi://GLib"
import Pango from "gi://Pango"
import { execAsync } from "ags/process"
import { restartCavaWithHz, GDK_HZ } from "../Helpers/cava"
import { YTDLP_AVAILABLE } from "../Helpers/YtDlp"
import { clearRecent, clearListened } from "../Helpers/ListenHistory"
import { isMusicBarVisible, showMusicBar, hideMusicBar } from "../Helpers/MusicBarVisibility"
import { LYRIC_SYNC_DEFAULT_US } from "../Helpers/Perf"
import { fnDebugEnabled } from "../Helpers/FnLogCollector"
import { loadSettings, saveSettings } from "../Helpers/UserSettings"
import { AGS_CACHE_DIR, AGS_CONFIG_DIR, HYPR_CONFIG_DIR } from "../Helpers/Paths"
import { placeWindowAtPointer } from "../Helpers/Monitor"
import { trackEscapeDismiss } from "../Helpers/FlyoutState"
import { setChromaArtworkPaletteEnabled } from "../Bar/MusicBar"
import { IC, iconImage } from "../Helpers/Icons"

const BATTERY_LIMIT_SCRIPT = '/usr/local/libexec/ags-battery-limit'
const AGS_LAUNCHER = GLib.build_filenamev([AGS_CONFIG_DIR, 'scripts', 'launch-ags.sh'])
const HYPRIDLE_LAUNCHER = GLib.build_filenamev([
  HYPR_CONFIG_DIR, 'scripts', 'hyprland', 'start-hypridle.sh',
])
const FNSESSION_BIN = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'fnsession'])

function restartAgs(): Promise<string> {
  return execAsync([
    'bash', '-c', 'ags quit -i ags-bar; sleep 0.3; nohup "$1" >/dev/null 2>&1 &',
    'ags-restart', AGS_LAUNCHER,
  ])
}

export { loadSettings, saveSettings }

function buildCavaPage(close: () => void): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')

  const settings = loadSettings()
  const initAuto = settings.cavaAutoHz !== false
  const initHz   = typeof settings.cavaManualHz === 'number' ? settings.cavaManualHz : GDK_HZ

  const sectionLbl = new Gtk.Label({ label: 'REFRESH RATE', visible: true, xalign: 0 })
  sectionLbl.get_style_context().add_class('settings-section')
  page.add(sectionLbl)

  const autoRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const autoLbl = new Gtk.Label({ label: 'Auto-detect Hz from monitor', visible: true, xalign: 0 })
  autoLbl.get_style_context().add_class('settings-label')
  autoLbl.set_hexpand(true)
  autoLbl.set_ellipsize(Pango.EllipsizeMode.END)
  autoRow.add(autoLbl)
  const autoSwitch = new Gtk.Switch({ visible: true })
  autoSwitch.set_active(initAuto)
  autoRow.add(autoSwitch)
  page.add(autoRow)

  const detectedLbl = new Gtk.Label({ label: `Detected: ${GDK_HZ} Hz`, visible: true, xalign: 0 })
  detectedLbl.get_style_context().add_class('settings-hint')
  page.add(detectedLbl)

  const manualRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const manualLbl = new Gtk.Label({ label: 'Manual refresh rate (Hz)', visible: true, xalign: 0 })
  manualLbl.get_style_context().add_class('settings-label')
  manualLbl.set_hexpand(true)
  manualLbl.set_ellipsize(Pango.EllipsizeMode.END)
  manualRow.add(manualLbl)
  const adj  = new Gtk.Adjustment({ lower: 1, upper: 999, step_increment: 1, page_increment: 10, value: initHz })
  const spin = new (Gtk as any).SpinButton({ adjustment: adj, digits: 0, numeric: true, visible: true })
  spin.set_sensitive(!initAuto)
  manualRow.add(spin)
  page.add(manualRow)

  autoSwitch.connect('state-set', (_sw: any, state: boolean) => {
    spin.set_sensitive(!state)
    saveSettings({ cavaAutoHz: state })
    return false
  })

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const applyBtn = new Gtk.Button({ label: '  Apply & Restart CAVA', visible: true })
  applyBtn.get_style_context().add_class('settings-apply-btn')
  applyBtn.connect('clicked', () => {
    const isAuto  = autoSwitch.get_active()
    const manualV = Math.round(adj.get_value())
    const hz      = isAuto ? GDK_HZ : manualV
    saveSettings({ cavaAutoHz: isAuto, cavaManualHz: manualV })
    restartCavaWithHz(hz, isAuto)
    close()
  })
  page.add(applyBtn)

  const hintLbl = new Gtk.Label({ label: 'Frame interval applies on next AGS restart', visible: true })
  hintLbl.get_style_context().add_class('settings-hint')
  page.add(hintLbl)

  return page
}

function buildYtdlpPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')

  const statusRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
  const statusIcon = new Gtk.Label({ visible: true })
  statusIcon.set_use_markup(true)
  statusIcon.set_markup(YTDLP_AVAILABLE
    ? '<span foreground="#a6e3a1">●</span>'
    : '<span foreground="#f38ba8">●</span>')
  statusRow.add(statusIcon)
  const statusLbl = new Gtk.Label({
    label: YTDLP_AVAILABLE ? 'yt-dlp detected' : 'yt-dlp not found - install it to enable filtering',
    visible: true, xalign: 0,
  })
  statusLbl.get_style_context().add_class('settings-label')
  statusLbl.set_hexpand(true)
  statusLbl.set_ellipsize(Pango.EllipsizeMode.END)
  statusRow.add(statusLbl)
  page.add(statusRow)

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const settings     = loadSettings()
  const initFilter   = settings.ytdlpMusicFilter !== false

  const sectionLbl = new Gtk.Label({ label: 'MUSIC FILTER', visible: true, xalign: 0 })
  sectionLbl.get_style_context().add_class('settings-section')
  page.add(sectionLbl)

  const filterRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const filterLbl = new Gtk.Label({ label: 'Only track music (filter YouTube videos)', visible: true, xalign: 0 })
  filterLbl.get_style_context().add_class('settings-label')
  filterLbl.set_hexpand(true)
  filterLbl.set_ellipsize(Pango.EllipsizeMode.END)
  filterRow.add(filterLbl)
  const filterSwitch = new Gtk.Switch({ visible: true, sensitive: YTDLP_AVAILABLE })
  filterSwitch.set_active(initFilter && YTDLP_AVAILABLE)
  filterRow.add(filterSwitch)
  page.add(filterRow)

  const filterHint = new Gtk.Label({
    label: 'Uses yt-dlp to check YouTube categories.\nResults cached for 7 days.',
    visible: true, xalign: 0,
  })
  filterHint.get_style_context().add_class('settings-hint')
  filterHint.set_line_wrap(true)
  page.add(filterHint)

  filterSwitch.connect('state-set', (_sw: any, state: boolean) => {
    saveSettings({ ytdlpMusicFilter: state })
    return false
  })

  if (!YTDLP_AVAILABLE) {
    const notAvailHint = new Gtk.Label({
      label: 'Install yt-dlp: sudo pacman -S yt-dlp',
      visible: true, xalign: 0,
    })
    notAvailHint.get_style_context().add_class('settings-hint')
    page.add(notAvailHint)
  }

  return page
}

function buildMusicBarPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')

  const settings   = loadSettings()
  const initInterv = Math.max(15, Math.min(300, Number(settings.historyIntervalS) || 30))

  const visSec = new Gtk.Label({ label: 'VISIBILITY', visible: true, xalign: 0 })
  visSec.get_style_context().add_class('settings-section')
  page.add(visSec)

  const visRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const visLbl = new Gtk.Label({ label: 'Show Music Bar', visible: true, xalign: 0 })
  visLbl.get_style_context().add_class('settings-label')
  visLbl.set_hexpand(true)
  visLbl.set_ellipsize(Pango.EllipsizeMode.END)
  visRow.add(visLbl)

  const visSwitch = new Gtk.Switch({ visible: true })
  visSwitch.set_active(isMusicBarVisible())
  visRow.add(visSwitch)
  page.add(visRow)

  visSwitch.connect('state-set', (_sw: any, state: boolean) => {
    if (state) showMusicBar(); else hideMusicBar()
    return false
  })

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const chromaSec = new Gtk.Label({ label: 'CHROMA COLORS', visible: true, xalign: 0 })
  chromaSec.get_style_context().add_class('settings-section')
  page.add(chromaSec)

  settingsSwitchRow(
    page,
    'Use artwork colors',
    'Build a 16-color Chroma palette from the current cover. CAVA thresholds exclude near-white and near-black tones. Disable to use the preset rainbow.',
    settings.chromaArtworkPalette !== false,
    state => {
      saveSettings({ chromaArtworkPalette: state })
      setChromaArtworkPaletteEnabled(state)
    },
  )

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const sectionLbl = new Gtk.Label({ label: 'LISTEN HISTORY', visible: true, xalign: 0 })
  sectionLbl.get_style_context().add_class('settings-section')
  page.add(sectionLbl)

  const intRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const intLbl = new Gtk.Label({
    label: 'Save interval (seconds)',
    visible: true, xalign: 0,
    tooltip_text: 'How often play time is saved to recently played & top listened',
  })
  intLbl.get_style_context().add_class('settings-label')
  intLbl.set_hexpand(true)
  intLbl.set_ellipsize(Pango.EllipsizeMode.END)
  intRow.add(intLbl)

  const adj  = new Gtk.Adjustment({ lower: 15, upper: 300, step_increment: 5, page_increment: 30, value: initInterv })
  const spin = new (Gtk as any).SpinButton({ adjustment: adj, digits: 0, numeric: true, visible: true })
  intRow.add(spin)
  page.add(intRow)

  const intHint = new Gtk.Label({
    label: 'Changes apply on next AGS restart.',
    visible: true, xalign: 0,
  })
  intHint.get_style_context().add_class('settings-hint')
  page.add(intHint)

  adj.connect('value-changed', () => {
    saveSettings({ historyIntervalS: Math.round(adj.get_value()) })
  })

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const clearSectionLbl = new Gtk.Label({ label: 'CLEAR DATA', visible: true, xalign: 0 })
  clearSectionLbl.get_style_context().add_class('settings-section')
  page.add(clearSectionLbl)

  const clearHint = new Gtk.Label({ label: 'Click once to arm, click again to confirm. Cannot be undone.', visible: true, xalign: 0 })
  clearHint.get_style_context().add_class('settings-hint')
  clearHint.set_line_wrap(true)
  page.add(clearHint)

  const clearRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
  page.add(clearRow)

  const makeClearBtn = (label: string, action: () => void): Gtk.Button => {
    const btn = new Gtk.Button({ label, visible: true })
    btn.get_style_context().add_class('settings-clear-btn')
    let timeoutId: any = null

    btn.connect('clicked', () => {
      if (btn.get_label() !== label) {

        if (timeoutId !== null) { GLib.source_remove(timeoutId); timeoutId = null }
        action()
        btn.set_label(label)
        btn.get_style_context().remove_class('settings-danger-armed')
      } else {

        btn.set_label('Confirm?')
        btn.get_style_context().add_class('settings-danger-armed')
        timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
          btn.set_label(label)
          btn.get_style_context().remove_class('settings-danger-armed')
          timeoutId = null
          return GLib.SOURCE_REMOVE
        })
      }
    })
    btn.connect('destroy', () => {
      if (timeoutId !== null) { GLib.source_remove(timeoutId); timeoutId = null }
    })

    return btn
  }

  clearRow.add(makeClearBtn('Clear Recently Played', clearRecent))
  clearRow.add(makeClearBtn('Clear Top Listened', clearListened))

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const lyricsSecLbl = new Gtk.Label({ label: 'LYRICS SOURCE', visible: true, xalign: 0 })
  lyricsSecLbl.get_style_context().add_class('settings-section')
  page.add(lyricsSecLbl)

  const initPriorityIsApi = settings.lyricsPriority === 'api'

  const lyricsPriRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const lyricsPriLbl = new Gtk.Label({
    label: 'Prefer lrclib.net over local .lyr files',
    visible: true, xalign: 0,
    tooltip_text: 'When off (default), local .lyr files in ~/lyrics take priority over the online lrclib.net database.',
  })
  lyricsPriLbl.get_style_context().add_class('settings-label')
  lyricsPriLbl.set_hexpand(true)
  lyricsPriLbl.set_ellipsize(Pango.EllipsizeMode.END)
  lyricsPriRow.add(lyricsPriLbl)

  const lyricsPriSwitch = new Gtk.Switch({ visible: true })
  lyricsPriSwitch.set_active(initPriorityIsApi)
  lyricsPriRow.add(lyricsPriSwitch)
  page.add(lyricsPriRow)

  const lyricsPriHint = new Gtk.Label({
    label: 'Default: local files first. Matches found online are cached to ~/lyrics automatically either way.',
    visible: true, xalign: 0,
  })
  lyricsPriHint.get_style_context().add_class('settings-hint')
  lyricsPriHint.set_line_wrap(true)
  page.add(lyricsPriHint)

  lyricsPriSwitch.connect('state-set', (_sw: any, state: boolean) => {
    saveSettings({ lyricsPriority: state ? 'api' : 'local' })
    return false
  })

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const syncSecLbl = new Gtk.Label({ label: 'LYRIC SYNC', visible: true, xalign: 0 })
  syncSecLbl.get_style_context().add_class('settings-section')
  page.add(syncSecLbl)

  const initSyncUs = Math.max(1000, Math.min(1_000_000,
    Number(settings.lyricSyncUs) || LYRIC_SYNC_DEFAULT_US))

  const syncRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const syncLbl = new Gtk.Label({
    label: 'Sync poll interval (µs)',
    visible: true, xalign: 0,
    tooltip_text: 'How often the active lyric line is re-evaluated, in microseconds. Lower = tighter sync, more CPU. GLib timers floor at 1ms (1000µs). Default 5000µs (5ms).',
  })
  syncLbl.get_style_context().add_class('settings-label')
  syncLbl.set_hexpand(true)
  syncLbl.set_ellipsize(Pango.EllipsizeMode.END)
  syncRow.add(syncLbl)

  const syncAdj  = new Gtk.Adjustment({ lower: 1000, upper: 1_000_000, step_increment: 500, page_increment: 5000, value: initSyncUs })
  const syncSpin = new (Gtk as any).SpinButton({ adjustment: syncAdj, digits: 0, numeric: true, visible: true })
  syncRow.add(syncSpin)
  page.add(syncRow)

  const syncHint = new Gtk.Label({
    label: 'Microseconds. Effective floor is 1000µs (1ms). Low-end device forces 300000µs (300ms). Applies on next AGS restart.',
    visible: true, xalign: 0,
  })
  syncHint.get_style_context().add_class('settings-hint')
  syncHint.set_line_wrap(true)
  page.add(syncHint)

  syncAdj.connect('value-changed', () => {
    saveSettings({ lyricSyncUs: Math.round(syncAdj.get_value()) })
  })

  return page
}

function buildNetworkPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')

  const settings = loadSettings()

  const layoutSec = new Gtk.Label({ label: 'NETWORK FLYOUTS', visible: true, xalign: 0 })
  layoutSec.get_style_context().add_class('settings-section')
  page.add(layoutSec)
  settingsSwitchRow(
    page,
    'Keep both flyouts visible',
    'When Wi-Fi and Bluetooth are open together, the first one moves left with a 5 px gap. Reopen both menus after changing this.',
    settings.networkFlyoutReorder !== false,
    state => saveSettings({ networkFlyoutReorder: state }),
  )

  return page
}

function buildBatteryPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')

  const settings  = loadSettings()
  const initLimit = settings.batteryChargeLimit80 === true

  const sectionLbl = new Gtk.Label({ label: 'CHARGE LIMIT', visible: true, xalign: 0 })
  sectionLbl.get_style_context().add_class('settings-section')
  page.add(sectionLbl)

  const limitRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const limitLbl = new Gtk.Label({
    label: 'Limit max charge to 80%',
    visible: true, xalign: 0,
    tooltip_text: 'Preserves battery health by capping charge at 80%. Asks for your password (pkexec) every time.',
  })
  limitLbl.get_style_context().add_class('settings-label')
  limitLbl.set_hexpand(true)
  limitLbl.set_ellipsize(Pango.EllipsizeMode.END)
  limitRow.add(limitLbl)

  const limitSwitch = new Gtk.Switch({ visible: true })
  limitSwitch.set_active(initLimit)
  limitRow.add(limitSwitch)
  page.add(limitRow)

  const limitHint = new Gtk.Label({
    label: 'Prompts for your password each time (pkexec).\nPersists across reboot once enabled (requires one-time systemd setup).',
    visible: true, xalign: 0,
  })
  limitHint.get_style_context().add_class('settings-hint')
  limitHint.set_line_wrap(true)
  page.add(limitHint)

  const errHint = new Gtk.Label({ label: '', visible: true, xalign: 0 })
  errHint.get_style_context().add_class('settings-hint')
  errHint.set_line_wrap(true)
  page.add(errHint)

  let suppress = false
  limitSwitch.connect('state-set', (sw: any, state: boolean) => {
    if (suppress) return false

    const target = state ? '80' : '100'
    errHint.set_label('Authenticating...')
    sw.set_sensitive(false)

    execAsync(['pkexec', BATTERY_LIMIT_SCRIPT, target])
      .then(() => {
        sw.set_state(state)
        saveSettings({ batteryChargeLimit80: state })
        errHint.set_label(state
          ? 'Charge limit set to 80%. Install the boot service so it survives reboot (see below).'
          : 'Charge limit removed (100%).')
        sw.set_sensitive(true)
      })
      .catch((err: any) => {
        dwarn('[battery-limit] pkexec failed:', err)
        errHint.set_label('Failed: auth cancelled or error. Reverted.')
        suppress = true
        sw.set_active(!state)
        suppress = false
        sw.set_state(!state)
        sw.set_sensitive(true)
      })

    return true
  })

  return page
}

function buildPerformancePage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')

  const settings = loadSettings()
  const initLow  = settings.lowEndDevice === true

  const sectionLbl = new Gtk.Label({ label: 'LOW-END DEVICE', visible: true, xalign: 0 })
  sectionLbl.get_style_context().add_class('settings-section')
  page.add(sectionLbl)

  const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const lbl = new Gtk.Label({
    label: 'Low-end device', visible: true, xalign: 0,
    tooltip_text: 'Disables Cava and the Chroma flyout background, clamps refreshes to ≥30s, and disables lrclib + yt-dlp.',
  })
  lbl.get_style_context().add_class('settings-label')
  lbl.set_hexpand(true)
  lbl.set_ellipsize(Pango.EllipsizeMode.END)
  row.add(lbl)

  const sw = new Gtk.Switch({ visible: true })
  sw.set_active(initLow)
  row.add(sw)
  page.add(row)

  const hint = new Gtk.Label({
    label: 'When enabled: Cava spectrum off (shows "-Low-end device enabled-"), Chroma '
      + 'background fully disabled, every seconds-scale widget refresh clamped to a 30s minimum, '
      + 'and lrclib.net + yt-dlp disabled.\n'
      + 'Toggling this RESTARTS AGS so it takes effect. Turn it off to restore all defaults.',
    visible: true, xalign: 0,
  })
  hint.get_style_context().add_class('settings-hint')
  hint.set_line_wrap(true)
  page.add(hint)

  sw.connect('state-set', (_s: any, state: boolean) => {
    saveSettings({ lowEndDevice: state })

    restartAgs()
      .catch((e: any) => dwarn('[low-end] restart failed:', e))
    return false
  })

  const motionRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const motionLbl = new Gtk.Label({
    label: 'Reduced motion',
    visible: true,
    xalign: 0,
    tooltip_text: 'Disables OSD fades, smooth gauge updates, and card rearrangement.',
  })
  motionLbl.get_style_context().add_class('settings-label')
  motionLbl.set_hexpand(true)
  motionLbl.set_ellipsize(Pango.EllipsizeMode.END)
  motionRow.add(motionLbl)

  const motionSwitch = new Gtk.Switch({ visible: true })
  motionSwitch.set_active(settings.reducedMotion === true)
  motionRow.add(motionSwitch)
  page.add(motionRow)

  const motionHint = new Gtk.Label({
    label: initLow
      ? 'Currently forced on by Low-end device mode. The saved preference applies again when Low-end mode is disabled.'
      : 'Disables OSD fade, gauge, and rearrangement animations. Toggling this restarts AGS.',
    visible: true,
    xalign: 0,
  })
  motionHint.get_style_context().add_class('settings-hint')
  motionHint.set_line_wrap(true)
  page.add(motionHint)

  motionSwitch.connect('state-set', (_s: any, state: boolean) => {
    saveSettings({ reducedMotion: state })
    restartAgs()
      .catch((e: any) => dwarn('[reduced-motion] restart failed:', e))
    return false
  })

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const effectsSecLbl = new Gtk.Label({ label: 'HYPRLAND EFFECTS', visible: true, xalign: 0 })
  effectsSecLbl.get_style_context().add_class('settings-section')
  page.add(effectsSecLbl)

  const effectsRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const effectsLbl = new Gtk.Label({
    label: 'Disable opacity and blur',
    visible: true,
    xalign: 0,
    tooltip_text: 'Forces Hyprland window opacity to 100% and disables compositor and layer blur.',
  })
  effectsLbl.get_style_context().add_class('settings-label')
  effectsLbl.set_hexpand(true)
  effectsLbl.set_ellipsize(Pango.EllipsizeMode.END)
  effectsRow.add(effectsLbl)

  const effectsSwitch = new Gtk.Switch({ visible: true })
  effectsSwitch.set_active(settings.disableHyprlandOpacityBlur === true)
  effectsRow.add(effectsSwitch)
  page.add(effectsRow)

  const effectsHint = new Gtk.Label({
    label: settings.disableHyprlandOpacityBlur === true
      ? 'Active: Hyprland window opacity is forced to 100% and all layer blur is disabled.'
      : 'Inactive: Hyprland uses the opacity and blur values from the normal configuration.',
    visible: true,
    xalign: 0,
  })
  effectsHint.get_style_context().add_class('settings-hint')
  effectsHint.set_line_wrap(true)
  page.add(effectsHint)

  effectsSwitch.connect('state-set', (_s: any, state: boolean) => {
    saveSettings({ disableHyprlandOpacityBlur: state })
    effectsSwitch.set_sensitive(false)
    effectsHint.set_label(state
      ? 'Disabling Hyprland opacity and blur…'
      : 'Restoring the normal Hyprland effects…')
    execAsync(['hyprctl', 'reload'])
      .then(() => {
        effectsSwitch.set_sensitive(true)
        effectsHint.set_label(state
          ? 'Active: Hyprland window opacity is forced to 100% and all layer blur is disabled.'
          : 'Inactive: Hyprland uses the opacity and blur values from the normal configuration.')
      })
      .catch((e: any) => {
        effectsSwitch.set_sensitive(true)
        effectsHint.set_label(`Hyprland reload failed: ${String(e)}`)
        dwarn('[hyprland-effects] reload failed:', e)
      })
    return false
  })

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const cacheSecLbl = new Gtk.Label({ label: 'CACHE', visible: true, xalign: 0 })
  cacheSecLbl.get_style_context().add_class('settings-section')
  page.add(cacheSecLbl)

  const cacheHint = new Gtk.Label({
    label: 'Clears the regenerable dotfiles cache: album art, wallpaper & clipboard '
      + 'thumbnails, yt-dlp categories, and the lrclib "no-lyrics" cache. Your listen '
      + 'history and logs are NOT touched. Click once to arm, again to confirm.',
    visible: true, xalign: 0,
  })
  cacheHint.get_style_context().add_class('settings-hint')
  cacheHint.set_line_wrap(true)
  page.add(cacheHint)

  const CACHE_DIR     = AGS_CACHE_DIR
  const CACHE_TARGETS = [
    'art',
    'wall-thumbs',
    'cliphist-thumbs',
    'ytdlp-categories.json',
    'lrclib-misses.json',
  ]
  const targetPaths   = CACHE_TARGETS.map(t => `${CACHE_DIR}/${t}`)

  const sizeLbl = new Gtk.Label({ label: 'Cache size: …', visible: true, xalign: 0 })
  sizeLbl.get_style_context().add_class('settings-hint')
  page.add(sizeLbl)

  const refreshSize = () => {
    execAsync([
      'bash', '-c', 'du -shc -- "$@" 2>/dev/null | tail -1 | cut -f1',
      'ags-cache-size', ...targetPaths,
    ])
      .then((s: string) => sizeLbl.set_label(`Cache size: ${s.trim() || '0'}`))
      .catch(() => sizeLbl.set_label('Cache size: -'))
  }
  refreshSize()

  const cacheBtn = new Gtk.Button({ label: 'Clear dotfiles cache', visible: true })
  cacheBtn.get_style_context().add_class('settings-clear-btn')
  let armed = false
  let armTimer: any = null
  const disarm = () => {
    if (armTimer !== null) { GLib.source_remove(armTimer); armTimer = null }
    armed = false
    cacheBtn.set_label('Clear dotfiles cache')
    cacheBtn.get_style_context().remove_class('settings-danger-armed')
  }
  cacheBtn.connect('clicked', () => {
    if (!armed) {
      armed = true
      cacheBtn.set_label('Confirm clear?')
      cacheBtn.get_style_context().add_class('settings-danger-armed')
      armTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => { armTimer = null; disarm(); return GLib.SOURCE_REMOVE })
      return
    }
    disarm()
    execAsync(['rm', '-rf', ...targetPaths])
      .then(() => { sizeLbl.set_label('Cache cleared ✓'); refreshSize() })
      .catch((e: any) => dwarn('[cache] clear failed:', e))
  })
  page.connect('destroy', () => {
    if (armTimer !== null) { GLib.source_remove(armTimer); armTimer = null }
  })
  page.add(cacheBtn)

  return page
}

function buildLoggingPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')

  const sectionLbl = new Gtk.Label({ label: 'FN-LOGS DEBUG MODE', visible: true, xalign: 0 })
  sectionLbl.get_style_context().add_class('settings-section')
  page.add(sectionLbl)

  const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const lbl = new Gtk.Label({ label: 'Enable Debug logging', visible: true, xalign: 0 })
  lbl.get_style_context().add_class('settings-label')
  lbl.set_hexpand(true)
  row.add(lbl)

  const debugEnabled = fnDebugEnabled()
  const sw = new Gtk.Switch({ visible: true })
  sw.set_active(debugEnabled)
  row.add(sw)
  page.add(row)

  const hint = new Gtk.Label({
    label: debugEnabled
      ? 'Active: FN-Logs is collecting Hyprland, Hyprlock, AGS, GJS and Astal output.'
      : 'Inactive: no journal follower, file follower, timer or polling loop is running.',
    visible: true, xalign: 0,
  })
  hint.get_style_context().add_class('settings-hint')
  hint.set_line_wrap(true)
  page.add(hint)

  const restartHint = new Gtk.Label({
    label: 'Changing this option restarts AGS so its own stdout/stderr is captured only while Debug is active.',
    visible: true, xalign: 0,
  })
  restartHint.get_style_context().add_class('settings-hint')
  restartHint.set_line_wrap(true)
  page.add(restartHint)

  sw.connect('state-set', (_s: any, state: boolean) => {
    saveSettings({ debugMode: state })
    sw.set_sensitive(false)
    hint.set_label(state ? 'Enabling Debug mode and restarting AGS…' : 'Disabling all collectors and restarting AGS…')
    restartAgs().catch((e: any) => {
      sw.set_sensitive(true)
      hint.set_label(`Restart failed: ${String(e)}`)
      dwarn('[fn-logs] restart failed:', e)
    })
    return false
  })

  return page
}

function settingsSwitchRow(
  page: Gtk.Box,
  label: string,
  hint: string,
  active: boolean,
  changed: (state: boolean) => void,
): Gtk.Switch {
  const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const text = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, visible: true, hexpand: true })
  const title = new Gtk.Label({ label, visible: true, xalign: 0 })
  title.get_style_context().add_class('settings-label')
  const sub = new Gtk.Label({ label: hint, visible: true, xalign: 0, wrap: true })
  sub.get_style_context().add_class('settings-hint')
  text.add(title); text.add(sub); row.add(text)
  const toggle = new Gtk.Switch({ visible: true, valign: Gtk.Align.CENTER, active })
  toggle.connect('state-set', (_self: Gtk.Switch, state: boolean) => { changed(state); return false })
  row.add(toggle); page.add(row)
  return toggle
}

function buildSessionPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')
  const settings = loadSettings()

  const idleTitle = new Gtk.Label({ label: 'AUTOMATIC LOCK', visible: true, xalign: 0 })
  idleTitle.get_style_context().add_class('settings-section')
  page.add(idleTitle)

  const restartIdle = () => execAsync([HYPRIDLE_LAUNCHER, '--restart'])
    .catch((error: any) => dwarn('[hypridle] restart failed:', error))
  const idleEnabled = settingsSwitchRow(
    page,
    'Lock after inactivity',
    'Runs the existing Hyprlock screen; it does not change suspend or lock security.',
    settings.idleLockEnabled !== false,
    state => { saveSettings({ idleLockEnabled: state }); restartIdle() },
  )

  const minutesRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const minutesLabel = new Gtk.Label({ label: 'Idle time (minutes)', visible: true, xalign: 0, hexpand: true })
  minutesLabel.get_style_context().add_class('settings-label')
  const minutesAdj = new Gtk.Adjustment({
    lower: 0.1, upper: 1440, step_increment: 0.1, page_increment: 1,
    value: Math.max(0.1, Math.min(1440, Number(settings.idleLockMinutes) || 30)),
  })
  const minutesSpin = new (Gtk as any).SpinButton({
    adjustment: minutesAdj, digits: 1, numeric: true, visible: true,
  })
  minutesSpin.set_sensitive(idleEnabled.get_active())
  minutesRow.add(minutesLabel); minutesRow.add(minutesSpin); page.add(minutesRow)
  const minutesHint = new Gtk.Label({ label: 'Fractions are accepted: 0.5 minutes = 30 seconds.', visible: true, xalign: 0 })
  minutesHint.get_style_context().add_class('settings-hint')
  page.add(minutesHint)
  idleEnabled.connect('notify::active', () => minutesSpin.set_sensitive(idleEnabled.get_active()))
  let idleDebounce: number | null = null
  minutesAdj.connect('value-changed', () => {
    saveSettings({ idleLockMinutes: Number(minutesAdj.get_value().toFixed(1)) })
    if (idleDebounce !== null) GLib.source_remove(idleDebounce)
    idleDebounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
      idleDebounce = null
      restartIdle()
      return GLib.SOURCE_REMOVE
    })
  })

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))
  const fnTitle = new Gtk.Label({ label: 'FNSESSION', visible: true, xalign: 0 })
  fnTitle.get_style_context().add_class('settings-section')
  page.add(fnTitle)

  settingsSwitchRow(
    page,
    'Load the latest session on startup',
    'Takes effect the next time Hyprland starts.',
    settings.fnsessionAutostart !== false,
    state => saveSettings({ fnsessionAutostart: state }),
  )

  const status = new Gtk.Label({ label: '', visible: true, xalign: 0, wrap: true, selectable: true })
  status.get_style_context().add_class('settings-hint')
  const saveRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
  const name = new Gtk.Entry({ visible: true, hexpand: true, placeholder_text: 'Session name' })
  const saveButton = new Gtk.Button({ label: 'Save', visible: true })
  saveButton.get_style_context().add_class('settings-apply-btn')
  saveRow.add(name); saveRow.add(saveButton); page.add(saveRow)

  const loadRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
  const sessions = new Gtk.ComboBoxText({ visible: true, hexpand: true })
  const refresh = new Gtk.Button({ label: 'Refresh', visible: true })
  const load = new Gtk.Button({ label: 'Load', visible: true })
  load.get_style_context().add_class('settings-apply-btn')
  loadRow.add(sessions); loadRow.add(refresh); loadRow.add(load); page.add(loadRow); page.add(status)

  const refreshSessions = () => {
    refresh.set_sensitive(false)
    execAsync([FNSESSION_BIN, 'list', '--json'])
      .then((raw: string) => {
        sessions.remove_all()
        const rows = JSON.parse(raw)
        if (Array.isArray(rows)) {
          rows.forEach(row => {
            if (row && typeof row.name === 'string') sessions.append_text(row.name)
          })
        }
        if (sessions.get_model()?.iter_n_children(null)) sessions.set_active(0)
        status.set_label(rows.length ? `${rows.length} saved session(s)` : 'No saved sessions')
      })
      .catch((error: any) => status.set_label(`Could not list sessions: ${String(error)}`))
      .finally(() => refresh.set_sensitive(true))
  }
  refresh.connect('clicked', refreshSessions)
  saveButton.connect('clicked', () => {
    const sessionName = name.get_text().trim()
    if (!sessionName) { status.set_label('Enter a session name first.'); name.grab_focus(); return }
    saveButton.set_sensitive(false)
    execAsync([FNSESSION_BIN, 'save', sessionName])
      .then((message: string) => { status.set_label(message.trim()); refreshSessions() })
      .catch((error: any) => status.set_label(`Save failed: ${String(error)}`))
      .finally(() => saveButton.set_sensitive(true))
  })
  load.connect('clicked', () => {
    const selected = sessions.get_active_text()
    if (!selected) { status.set_label('Choose a saved session first.'); return }
    load.set_sensitive(false)
    status.set_label(`Loading ${selected}…`)
    execAsync([FNSESSION_BIN, 'load', selected])
      .then((message: string) => status.set_label(message.trim()))
      .catch((error: any) => status.set_label(`Load failed: ${String(error)}`))
      .finally(() => load.set_sensitive(true))
  })
  refreshSessions()
  page.connect('destroy', () => {
    if (idleDebounce !== null) GLib.source_remove(idleDebounce)
  })
  return page
}

function buildTerminalPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 16, visible: true })
  page.get_style_context().add_class('settings-page')
  const settings = loadSettings()
  const title = new Gtk.Label({ label: 'SHELL STARTUP', visible: true, xalign: 0 })
  title.get_style_context().add_class('settings-section')
  page.add(title)
  const options: Array<[string, string, string, boolean]> = [
    ['terminalStarship', 'Starship prompt', 'Disables the custom prompt when off.', true],
    ['terminalPyenv', 'Pyenv initialization', 'One of the slower startup components; disable if Python version switching is unused.', true],
    ['terminalCompletions', 'Zsh completion system', 'Keeps the completion cache fast; disable only if tab completion is unnecessary.', true],
    ['terminalPlugins', 'Interactive Zsh plugins', 'Autosuggestions, history search, sudo helper and notifications.', true],
  ]
  for (const [key, label, hint, fallback] of options) {
    settingsSwitchRow(page, label, hint, settings[key] ?? fallback, state => saveSettings({ [key]: state }))
  }
  const note = new Gtk.Label({ label: 'Changes apply to newly opened terminal shells.', visible: true, xalign: 0, wrap: true })
  note.get_style_context().add_class('settings-hint')
  page.add(note)
  return page
}

export default function SettingsPanel() {
  let win: Astal.Window
  let firstMap = true
  let buildContent = () => {}
  let contentScroll: Gtk.ScrolledWindow | null = null
  const CENTER = Astal.WindowAnchor.NONE

  const close = () => { try { win?.set_visible(false) } catch (_) {} }
  const fitToPointerMonitor = () => {
    const geo = placeWindowAtPointer(win)
    contentScroll?.set_size_request(
      Math.max(420, Math.min(680, geo.width - 230)),
      Math.max(360, Math.min(560, geo.height - 180)),
    )
  }

  return (
    <window
      $={(self: any) => {
        win = self
        trackEscapeDismiss(self, close)
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
      name="cava-settings"
      class="SettingsPanel"
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
      <box class="settings-root" orientation={Gtk.Orientation.VERTICAL} spacing={0}
        $={(root: any) => {
          buildContent = () => {
          const body = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, visible: true })
          body.get_style_context().add_class('settings-shell-body')
          root.add(body)

          const sidebar = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true,
          })
          sidebar.get_style_context().add_class('settings-sidebar')

          const brand = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            visible: true,
          })
          brand.get_style_context().add_class('settings-brand')
          brand.add(iconImage('cog', IC.accent, 17))
          const brandLabel = new Gtk.Label({ label: 'Settings', visible: true, xalign: 0 })
          brandLabel.get_style_context().add_class('settings-brand-title')
          brand.add(brandLabel)
          sidebar.add(brand)
          sidebar.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

          const nav = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
            visible: true,
            vexpand: true,
          })
          nav.get_style_context().add_class('settings-nav')
          sidebar.add(nav)
          body.add(sidebar)

          body.add(new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL, visible: true }))

          const pageFrame = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true,
            hexpand: true, vexpand: true,
          })
          pageFrame.get_style_context().add_class('settings-page-frame')
          body.add(pageFrame)

          const pageHeader = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            visible: true,
          })
          pageHeader.get_style_context().add_class('settings-page-header')

          const pageHeaderText = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 2,
            visible: true,
            hexpand: true,
            valign: Gtk.Align.CENTER,
          })
          const pageTitle = new Gtk.Label({ label: 'CAVA', visible: true, xalign: 0 })
          pageTitle.get_style_context().add_class('settings-page-title')
          const pageSubtitle = new Gtk.Label({
            label: 'Visualizer refresh and frame timing.',
            visible: true,
            xalign: 0,
          })
          pageSubtitle.get_style_context().add_class('settings-page-subtitle')
          pageHeaderText.add(pageTitle)
          pageHeaderText.add(pageSubtitle)
          pageHeader.add(pageHeaderText)
          pageFrame.add(pageHeader)
          pageFrame.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

          const contentWrap = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
            visible: true,
            hexpand: true,
            vexpand: true,
          })
          contentWrap.get_style_context().add_class('settings-content-wrap')
          pageFrame.add(contentWrap)

          const cavaPage     = buildCavaPage(close)
          const ytdlpPage    = buildYtdlpPage()
          const musicBarPage = buildMusicBarPage()
          const networkPage  = buildNetworkPage()
          const batteryPage  = buildBatteryPage()
          const perfPage     = buildPerformancePage()
          const loggingPage  = buildLoggingPage()
          const sessionPage  = buildSessionPage()
          const terminalPage = buildTerminalPage()
          ytdlpPage.set_visible(false)
          musicBarPage.set_visible(false)
          networkPage.set_visible(false)
          batteryPage.set_visible(false)
          perfPage.set_visible(false)
          loggingPage.set_visible(false)
          sessionPage.set_visible(false)
          terminalPage.set_visible(false)

          contentScroll = new Gtk.ScrolledWindow({ visible: true, hexpand: true, vexpand: true })
          contentScroll.get_style_context().add_class('settings-content')

          contentScroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
          contentScroll.set_size_request(680, 560)
          fitToPointerMonitor()
          const pagesBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
          pagesBox.add(cavaPage)
          pagesBox.add(ytdlpPage)
          pagesBox.add(musicBarPage)
          pagesBox.add(networkPage)
          pagesBox.add(batteryPage)
          pagesBox.add(perfPage)
          pagesBox.add(loggingPage)
          pagesBox.add(sessionPage)
          pagesBox.add(terminalPage)
          contentScroll.add(pagesBox)
          contentWrap.add(contentScroll)

          const pages = [cavaPage, ytdlpPage, musicBarPage, networkPage, batteryPage, perfPage, loggingPage, sessionPage, terminalPage]
          const pageInfo = [
            ['CAVA', 'Visualizer refresh and frame timing.'],
            ['YtDlp', 'Music detection and media filtering.'],
            ['MusicBar', 'Visibility, history and lyrics behaviour.'],
            ['Network', 'Wi-Fi and Bluetooth flyout layout.'],
            ['Battery', 'Charging thresholds and battery protection.'],
            ['Performance', 'Changes that affect AGS and Hyprland rendering.'],
            ['Logging', 'FN-Logs collection and debug output.'],
            ['Session', 'Automatic lock and fnsession behaviour.'],
            ['Terminal', 'Shell startup and terminal integration.'],
          ] as const
          const navBtns: Gtk.Button[] = []

          const makeNavBtn = (label: string, pageIdx: number): Gtk.Button => {
            const btn = new Gtk.Button({ label, visible: true })
            btn.get_style_context().add_class('settings-nav-btn')
            btn.set_relief(Gtk.ReliefStyle.NONE)
            btn.set_hexpand(true)
            btn.set_halign(Gtk.Align.FILL)
            btn.connect('clicked', () => {
              navBtns.forEach(b => b.get_style_context().remove_class('active'))
              btn.get_style_context().add_class('active')
              pages.forEach((p, i) => p.set_visible(i === pageIdx))
              pageTitle.set_label(pageInfo[pageIdx][0])
              pageSubtitle.set_label(pageInfo[pageIdx][1])
            })
            navBtns.push(btn)
            nav.add(btn)
            return btn
          }

          const cavaNavBtn = makeNavBtn('CAVA', 0)
          makeNavBtn('YtDlp', 1)
          makeNavBtn('MusicBar', 2)
          makeNavBtn('NETWORK', 3)
          makeNavBtn('BATTERY', 4)
          makeNavBtn('PERFORMANCE', 5)
          makeNavBtn('LOGGING', 6)
          makeNavBtn('SESSION', 7)
          makeNavBtn('TERMINAL', 8)

          cavaNavBtn.get_style_context().add_class('active')

          const footer = new Gtk.Label({ label: 'Press Esc to close', visible: true, xalign: 0 })
          footer.get_style_context().add_class('settings-hint')
          footer.get_style_context().add_class('settings-footer')
          pageFrame.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))
          pageFrame.add(footer)
          win?.queue_resize()
          }
        }}
      />
      </revealer>
    </window>
  )
}
