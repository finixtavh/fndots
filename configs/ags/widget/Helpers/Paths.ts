// Paths
import GLib from "gi://GLib"

export const HOME_DIR = GLib.get_home_dir()

const absoluteEnvDir = (variable: string, fallback: string): string => {
  const configured = GLib.getenv(variable)
  return configured && GLib.path_is_absolute(configured) ? configured : fallback
}

export const CONFIG_HOME = absoluteEnvDir(
  'XDG_CONFIG_HOME',
  GLib.build_filenamev([HOME_DIR, '.config']),
)
export const CACHE_HOME = absoluteEnvDir(
  'XDG_CACHE_HOME',
  GLib.build_filenamev([HOME_DIR, '.cache']),
)
export const STATE_HOME = absoluteEnvDir(
  'XDG_STATE_HOME',
  GLib.build_filenamev([HOME_DIR, '.local', 'state']),
)
export const DATA_HOME = absoluteEnvDir(
  'XDG_DATA_HOME',
  GLib.build_filenamev([HOME_DIR, '.local', 'share']),
)

export const AGS_CONFIG_DIR = GLib.build_filenamev([CONFIG_HOME, 'ags'])
export const AGS_CACHE_DIR = GLib.build_filenamev([CACHE_HOME, 'ags'])
export const AGS_STATE_DIR = GLib.build_filenamev([STATE_HOME, 'ags'])
export const HYPR_CONFIG_DIR = GLib.build_filenamev([CONFIG_HOME, 'hypr'])
export const FN_APPS_DIR = GLib.build_filenamev([HOME_DIR, 'fn-apps'])
export const FNWALL_DIR = GLib.build_filenamev([FN_APPS_DIR, 'fnwall'])

export const cachePath = (...parts: string[]): string =>
  GLib.build_filenamev([CACHE_HOME, ...parts])

export const statePath = (...parts: string[]): string =>
  GLib.build_filenamev([STATE_HOME, ...parts])
