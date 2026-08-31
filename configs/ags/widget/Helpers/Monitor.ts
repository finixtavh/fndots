// Monitor
import Gdk from "gi://Gdk"

export function monitorAtPointer(): Gdk.Monitor | null {
  try {
    const display = Gdk.Display.get_default()
    const pointer = display?.get_device_manager()?.get_client_pointer()
    const [, x, y] = pointer?.get_position() ?? [null, 0, 0]
    return display?.get_monitor_at_point(x, y) ?? display?.get_primary_monitor() ?? display?.get_monitor(0) ?? null
  } catch (_) {
    return Gdk.Display.get_default()?.get_monitor(0) ?? null
  }
}

export function placeWindowAtPointer(window: any): Gdk.Rectangle {
  const monitor = monitorAtPointer()
  if (monitor) {
    try { window.set_property('gdkmonitor', monitor) }
    catch (_) { try { window.gdkmonitor = monitor } catch (_) {} }
    return monitor.get_geometry()
  }
  return new Gdk.Rectangle({ x: 0, y: 0, width: 1920, height: 1080 })
}
