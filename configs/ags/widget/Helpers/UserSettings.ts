// User Settings
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import { AGS_CONFIG_DIR } from "./Paths"
import { dwarn } from "./DashLog"

export type UserSettings = Record<string, any>

const SETTINGS_FILE = GLib.build_filenamev([AGS_CONFIG_DIR, 'user-settings.json'])
const decoder = new TextDecoder()
const OBSOLETE_KEYS = ['networkBackend', 'networkBackendCached', 'networkAutoCache'] as const

function withoutObsoleteKeys(settings: UserSettings): UserSettings {
  const clean = { ...settings }
  OBSOLETE_KEYS.forEach(key => { delete clean[key] })
  return clean
}

export function loadSettings(): UserSettings {
  try {
    if (GLib.file_test(SETTINGS_FILE, GLib.FileTest.EXISTS)) GLib.chmod(SETTINGS_FILE, 0o600)
    const [ok, raw] = GLib.file_get_contents(SETTINGS_FILE)
    if (ok) {
      const parsed = JSON.parse(decoder.decode(raw))
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return withoutObsoleteKeys(parsed)
      }
    }
  } catch (err) {
    dwarn('[UserSettings] load failed:', err)
  }
  return {}
}

export function saveSettings(updates: UserSettings): void {
  try {
    const current = loadSettings()
    GLib.mkdir_with_parents(GLib.path_get_dirname(SETTINGS_FILE), 0o700)
    Gio.File.new_for_path(SETTINGS_FILE).replace_contents(
      new TextEncoder().encode(JSON.stringify(withoutObsoleteKeys({ ...current, ...updates }), null, 2)),
      null, false,
      Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
      null,
    )
    GLib.chmod(SETTINGS_FILE, 0o600)
  } catch (err) {
    dwarn('[UserSettings] save failed:', err)
  }
}
