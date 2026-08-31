
import app from "ags/gtk3/app"
import GLib from "gi://GLib"
import { execAsync, subprocess, Process } from "ags/process"
import style from "./style.scss"
import Bar from "./widget/Bar/Bar"
import MusicBar, { toggleNowPlaying } from "./widget/Bar/MusicBar"
import PowerMenu from "./widget/Panels/PowerMenu"
import OSD from "./widget/Panels/OSD"
import NotificationCenter from "./widget/Panels/NotificationCenter"
import NotificationPopup from "./widget/Panels/NotificationPopup"
import CommandCenter from "./widget/Panels/CommandCenter"
import Keybinds from "./widget/Panels/Keybinds"
import SettingsPanel from "./widget/Panels/SettingsPanel"
import DashboardPanel, { showDashboardPage } from "./widget/Panels/DashboardPanel"
import AppLauncher, { toggleAppLauncher } from "./widget/Panels/AppLauncher"
import { dwarn } from "./widget/Helpers/DashLog"
import { FN_DEBUG, startFnLogCollector, stopFnLogCollector } from "./widget/Helpers/FnLogCollector"
import {
  dismissEscapeFlyouts,
  isFlyoutWindow,
  trackFlyoutWindow,
} from "./widget/Helpers/FlyoutState"
import { AGS_CONFIG_DIR } from "./widget/Helpers/Paths"
import { emitOsdEvent } from "./widget/Helpers/OsdEvents"

const FOCUS_FIX_SCRIPT = GLib.build_filenamev([AGS_CONFIG_DIR, 'scripts', 'hypr-focus-fix.py'])
const FOCUS_FIX_PKILL_RE = `^/usr/bin/python3 .*/${FOCUS_FIX_SCRIPT.split('/').pop()!.replace(/\./g, '\\.')}$`
let focusFixProc: Process | null = null
let focusFixEnabled = false

function killFocusFix(): Promise<void> {
  if (focusFixProc) {
    try { focusFixProc.kill() } catch (_) {}
    focusFixProc = null
    return Promise.resolve()
  }
  return execAsync(['pkill', '-f', FOCUS_FIX_PKILL_RE]).then(() => {}).catch(() => {})
}

function startHyprFocusFix() {
  focusFixEnabled = true
  killFocusFix().finally(() => {
    if (!focusFixEnabled) return
    focusFixProc = subprocess(
      ['/usr/bin/python3', FOCUS_FIX_SCRIPT],
      () => {},
      (err: string) => dwarn('[hypr-focus-fix]', err),
    )
    focusFixProc.connect('exit', () => { focusFixProc = null })
  })
}

function stopHyprFocusFix() {
  focusFixEnabled = false
  killFocusFix()
}

app.start({
  instanceName: "ags-bar",
  css: style,

  requestHandler(argv: string[], res: (response: any) => void) {
    const cmd = argv.join(' ').trim()
    if (cmd === "toggle-nowplaying") { toggleNowPlaying(); res("ok") }
    else if (cmd === "toggle-app-launcher") { toggleAppLauncher(); res("ok") }
    else if (cmd === "show-dashboard-emoji") { showDashboardPage('emoji'); res("ok") }
    else if (cmd === "dismiss-escape-flyouts") { res(String(dismissEscapeFlyouts())) }
    else if (cmd === "osd-caps") { emitOsdEvent('caps'); res("ok") }
    else if (cmd === "osd-output-mute") { emitOsdEvent('output-mute'); res("ok") }
    else if (cmd === "osd-input-mute") { emitOsdEvent('input-mute'); res("ok") }
    else res(`unknown request: ${cmd}`)
  },
  main() {

    if (FN_DEBUG) {
      startFnLogCollector()
      app.connect('shutdown', stopFnLogCollector)
    }
    startHyprFocusFix()
    app.connect('shutdown', stopHyprFocusFix)
    const monitors = app.get_monitors()
    monitors.forEach(monitor => {
      Bar(monitor)
      MusicBar(monitor)
      NotificationCenter(monitor)
      NotificationPopup(monitor)
    })
    OSD(monitors)
    PowerMenu()
    CommandCenter()
    Keybinds()
    SettingsPanel()
    DashboardPanel()
    AppLauncher()

    const untrackFlyoutWindows = app.get_windows()
      .filter(isFlyoutWindow)
      .map(trackFlyoutWindow)
    app.connect('shutdown', () => {
      for (const untrack of untrackFlyoutWindows) untrack()
    })
  },
})
