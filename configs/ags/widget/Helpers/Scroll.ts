// Scroll
import { Gdk } from "ags/gtk3"

export function scrollPercentDelta(event: any): number {
  try {
    const [smooth, , dy] = event.get_scroll_deltas()
    if (smooth && Number.isFinite(dy)) {
      if (Math.abs(dy) < 0.001) return 0
      return dy < 0 ? 2 : -2
    }
  } catch (_) {}

  try {
    const [, direction] = event.get_scroll_direction()
    if (direction === Gdk.ScrollDirection.UP) return 2
    if (direction === Gdk.ScrollDirection.DOWN) return -2
  } catch (_) {}
  return 0
}
