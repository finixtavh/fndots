// HyprFocus safe focus helpers
import { execAsync } from "ags/process"
import { derr } from "./DashLog"

const SAFE_CLASS_RE = /^[A-Za-z0-9._\- ]+$/

/**
 * Build a hyprctl dispatch command as an argv-array (no shell).
 * This avoids shell injection from WM_CLASS or other window properties.
 */
function hyprDispatch(lua: string): string[] {
  return ['hyprctl', 'dispatch', lua, '']
}

/**
 * Focus a Hyprland client safely.
 *
 * Primary path: focus by hex address (safe, no user-controlled input).
 * Fallback: focus by WM_CLASS, validated against a safe charset.
 *
 * @param address - The hex address of the client (e.g. "0x12345678")
 * @param cls     - The WM_CLASS of the client (used as fallback)
 * @param wsId    - Optional workspace ID to focus first
 * @param tag     - Log tag for errors (default: '[focus]')
 */
export function focusClient(
  address: string,
  cls: string,
  wsId?: number | null,
  tag = '[focus]',
): void {
  const focusByAddr = () =>
    execAsync(hyprDispatch(`hl.dsp.focus({window="address:${address}"})`))
      .catch(() => {
        if (!cls || !SAFE_CLASS_RE.test(cls)) {
          if (cls) derr(tag, `unsafe WM_CLASS skipped: ${cls}`)
          return
        }
        return execAsync(hyprDispatch(`hl.dsp.focus({window="class:${cls}"})`))
      })
      .catch((e: any) => derr(tag, e))

  if (wsId != null) {
    execAsync(hyprDispatch(`hl.dsp.focus({workspace="${wsId}"})`))
      .then(focusByAddr)
      .catch(focusByAddr)
  } else {
    focusByAddr()
  }
}

/**
 * Focus a workspace by ID safely (argv-array, no shell).
 */
export function focusWorkspace(wsId: string | number): Promise<string> {
  return execAsync(hyprDispatch(`hl.dsp.focus({workspace="${wsId}"})`))
}
