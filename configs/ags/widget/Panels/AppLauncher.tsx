// App Launcher
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import { execAsync } from "ags/process"
import { createState, createEffect, createBinding, onCleanup } from "ags"
import GLib from "gi://GLib"
import AstalApps from "gi://AstalApps"
import AstalHyprland from "gi://AstalHyprland"
import { placeWindowAtPointer } from "../Helpers/Monitor"
import { trackEscapeDismiss } from "../Helpers/FlyoutState"
import { focusClient } from "../Helpers/HyprFocus"

type Tab = "apps" | "windows"

const MAX_VISIBLE_RESULTS = 7
const RESULT_ROW_HEIGHT = 48
const RESULT_GAP = 2
function resultsViewportHeight(): number {

  return MAX_VISIBLE_RESULTS * RESULT_ROW_HEIGHT
    + (MAX_VISIBLE_RESULTS - 1) * RESULT_GAP
}
const DEFAULT_INPUT = "? "
const MODE_ORDER: Tab[] = ["apps", "windows"]

function symbolFor(tab: Tab): "?" | "$" {
  if (tab === "windows") return "$"
  return "?"
}

function parseInput(raw: string): { tab: Tab; query: string } {
  const first = raw.charAt(0)

  if (first === "$") {
    return { tab: "windows", query: raw.slice(1).trimStart() }
  }

  if (first === "?") {
    return { tab: "apps", query: raw.slice(1).trimStart() }
  }

  return { tab: "apps", query: raw.trimStart() }
}

function inputBody(raw: string): string {
  return /^[?$]/.test(raw) ? raw.slice(1).trimStart() : raw.trimStart()
}

let entryRef: Gtk.Entry | null = null
let revealerRef: Gtk.Revealer | null = null
let launcherVisible = false
const launcherVisibilityListeners = new Set<(visible: boolean) => void>()

function publishLauncherVisibility(visible: boolean): void {
  if (launcherVisible === visible) return
  launcherVisible = visible
  launcherVisibilityListeners.forEach(listener => listener(visible))
}

export function subscribeAppLauncherVisibility(listener: (visible: boolean) => void): () => void {
  launcherVisibilityListeners.add(listener)
  listener(launcherVisible)
  return () => launcherVisibilityListeners.delete(listener)
}

function resetInput() {
  if (!entryRef) return
  entryRef.set_text(DEFAULT_INPUT)
  entryRef.set_position(-1)
}

export function toggleAppLauncher() {
  const win = app.get_window("app-launcher")
  if (!win) return

  if (win.get_visible()) {
    revealerRef?.set_reveal_child(false)
    const fadeOut = () => {
      let opacity = win.get_opacity()
      if (opacity <= 0.05) {
        win.set_visible(false)
        win.set_opacity(1)
        resetInput()
        return GLib.SOURCE_REMOVE
      }
      win.set_opacity(Math.max(0, opacity - 0.15))
      return GLib.SOURCE_CONTINUE
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8, fadeOut)
    return
  }

  revealerRef?.set_reveal_child(false)
  resetInput()
  win.set_opacity(0)
  win.set_visible(true)

  const fadeIn = () => {
    let opacity = win.get_opacity()
    if (opacity >= 0.95) {
      win.set_opacity(1)
      revealerRef?.set_reveal_child(true)
      entryRef?.grab_focus()
      entryRef?.set_position(-1)
      return GLib.SOURCE_REMOVE
    }
    win.set_opacity(Math.min(1, opacity + 0.15))
    return GLib.SOURCE_CONTINUE
  }
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, 8, fadeIn)
}

export default function AppLauncher() {
  const [query, setQuery] = createState("")
  const [tab, setTab] = createState<Tab>("apps")
  const [selected, setSelected] = createState(0)

  const apps = AstalApps.Apps.new()
  const hypr = AstalHyprland.get_default()
  let rootWidget: Gtk.Widget | null = null
  const clients = createBinding(hypr, "clients")

  let resultsBox: Gtk.Box | null = null
  let resultsScroll: Gtk.ScrolledWindow | null = null
  let currentResults: any[] = []
  let currentSelected = 0
  let selectedWidget: Gtk.Widget | null = null

  const getResults = (mode: Tab, text: string): any[] => {
    if (mode === "apps") {

      return text ? apps.fuzzy_query(text) : apps.get_list()
    }

    if (mode === "windows") {
      const allClients = hypr.get_clients()
      if (!text) return allClients

      const lower = text.toLowerCase()
      return allClients.filter((client: any) => {
        const cls = (client.get_class() || "").toLowerCase()
        const title = (client.get_title() || "").toLowerCase()
        const workspace = String(client.get_workspace()?.get_id() ?? "")
        return cls.includes(lower)
          || title.includes(lower)
          || workspace.includes(lower)
      })
    }

    return []
  }

  const close = () => {
    revealerRef?.set_reveal_child(false)
    app.get_window("app-launcher")?.set_visible(false)
    resetInput()
    setQuery("")
    setTab("apps")
    setSelected(0)
  }

  const executeApp = (appItem: AstalApps.Application) => {
    appItem.launch()
    close()
  }

  const focusWindow = (client: any) => {
    focusClient(
      client.get_address(),
      client.get_class(),
      client.get_workspace()?.get_id(),
      '[app-launcher]',
    )
    close()
  }

  const executeSelected = () => {
    if (currentResults.length === 0) return

    const index = Math.min(selected(), currentResults.length - 1)
    const item = currentResults[index]

    if (tab() === "apps") executeApp(item as AstalApps.Application)
    else focusWindow(item)
  }

  const setMode = (next: Tab) => {
    const body = inputBody(entryRef?.get_text() ?? "")
    const text = `${symbolFor(next)}${body ? ` ${body}` : " "}`

    if (entryRef) {
      entryRef.set_text(text)
      entryRef.set_position(-1)
    } else {
      setTab(next)
      setQuery(body)
    }

    setSelected(0)
  }

  const cycleMode = () => {
    const current = parseInput(entryRef?.get_text() ?? "").tab
    const index = MODE_ORDER.indexOf(current)
    setMode(MODE_ORDER[(index + 1) % MODE_ORDER.length])
  }

  const handleKey = (_self: any, event: any) => {
    const [, keyval] = event.get_keyval()
    const count = currentResults.length

    if (keyval === Gdk.KEY_Escape) {
      const raw = entryRef?.get_text() ?? DEFAULT_INPUT
      if (raw !== DEFAULT_INPUT) {
        resetInput()
        setSelected(0)
      } else {
        close()
      }
      return true
    }

    if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
      executeSelected()
      return true
    }

    if (keyval === Gdk.KEY_Down) {
      setSelected(count > 0 ? (selected() + 1) % count : 0)
      return true
    }

    if (keyval === Gdk.KEY_Up) {
      setSelected(count > 0 ? (selected() - 1 + count) % count : 0)
      return true
    }

    if (keyval === Gdk.KEY_Tab) {
      cycleMode()
      return true
    }

    return false
  }

  const makeTextColumn = (
    nameText: string,
    descriptionText: string,
  ): Gtk.Box => {
    const column = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 1,
      visible: true,
      hexpand: true,
    })

    const name = new Gtk.Label({
      label: nameText,
      visible: true,
      xalign: 0,
      hexpand: false,
      halign: Gtk.Align.START,
    })
    name.get_style_context().add_class("launcher-result-name")
    name.set_ellipsize(3)
    name.set_single_line_mode(true)

    const description = new Gtk.Label({
      label: descriptionText,
      visible: true,
      xalign: 0,
      hexpand: true,
    })
    description.get_style_context().add_class("launcher-result-desc")
    description.set_ellipsize(3)
    description.set_single_line_mode(true)

    column.add(name)
    column.add(description)
    return column
  }

  const buildResultItem = (item: any, mode: Tab): Gtk.Widget => {
    const button = new Gtk.Button({ visible: true })
    button.get_style_context().add_class("launcher-result")
    button.set_size_request(-1, RESULT_ROW_HEIGHT)

    const row = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
      visible: true,
      hexpand: true,
    })
    row.set_valign(Gtk.Align.CENTER)

    if (mode === "apps") {
      const appItem = item as AstalApps.Application
      const icon = new Gtk.Image({
        icon_name: appItem.icon_name,
        pixel_size: 22,
        visible: true,
      })
      icon.get_style_context().add_class("launcher-result-icon")
      icon.set_valign(Gtk.Align.CENTER)
      row.add(icon)
      row.add(makeTextColumn(
        appItem.name,
        appItem.description || "Application",
      ))
      button.connect("clicked", () => executeApp(appItem))
    } else {
      const client = item as any
      const cls = client.get_class() || "application-x-executable"
      const title = client.get_title() || "Untitled window"
      const workspace = client.get_workspace()?.get_id()
      const description = workspace != null
        ? `Workspace ${workspace}  -  ${title}`
        : title

      const icon = new Gtk.Image({
        icon_name: cls.toLowerCase(),
        pixel_size: 22,
        visible: true,
      })
      icon.get_style_context().add_class("launcher-result-icon")
      icon.set_valign(Gtk.Align.CENTER)
      row.add(icon)
      row.add(makeTextColumn(cls, description))
      button.connect("clicked", () => focusWindow(client))
    }

    button.add(row)
    button.connect("key-press-event", handleKey)
    return button
  }

  const scrollSelectedIntoView = (selectedIndex: number) => {
    if (!resultsBox || !resultsScroll || currentResults.length === 0) return

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      if (!resultsBox || !resultsScroll) return GLib.SOURCE_REMOVE

      const children = resultsBox.get_children()
      const index = Math.min(selectedIndex, children.length - 1)
      const child = children[index]
      if (!child) return GLib.SOURCE_REMOVE

      const adjustment = resultsScroll.get_vadjustment()
      const allocation = child.get_allocation()
      const rowTop = allocation.y
      const rowBottom = rowTop + allocation.height
      const viewTop = adjustment.get_value()
      const viewBottom = viewTop + adjustment.get_page_size()

      let nextValue = viewTop
      if (rowTop < viewTop) nextValue = rowTop
      else if (rowBottom > viewBottom) {
        nextValue = rowBottom - adjustment.get_page_size()
      }

      const maxValue = Math.max(
        adjustment.get_lower(),
        adjustment.get_upper() - adjustment.get_page_size(),
      )
      adjustment.set_value(Math.max(
        adjustment.get_lower(),
        Math.min(nextValue, maxValue),
      ))

      return GLib.SOURCE_REMOVE
    })
  }

  const updateSelection = (selectedIndex: number) => {
    currentSelected = selectedIndex
    selectedWidget?.get_style_context().remove_class("selected")
    selectedWidget = null

    if (!resultsBox || currentResults.length === 0) return
    const children = resultsBox.get_children()
    const index = Math.min(selectedIndex, children.length - 1)
    selectedWidget = children[index] ?? null
    selectedWidget?.get_style_context().add_class("selected")
    scrollSelectedIntoView(index)
  }

  const updateResults = (mode: Tab, text: string) => {
    if (!resultsBox) return

    selectedWidget = null
    for (const child of resultsBox.get_children()) {
      resultsBox.remove(child)
      child.destroy()
    }

    currentResults = getResults(mode, text)

    if (resultsScroll) {
      const viewportHeight = resultsViewportHeight()
      resultsScroll.set_propagate_natural_height(false)
      resultsScroll.set_min_content_height(viewportHeight)
      resultsScroll.set_max_content_height(viewportHeight)
      resultsScroll.set_size_request(-1, viewportHeight)
    }

    if (currentResults.length === 0) {
      const message = mode === "apps"
        ? "No applications found"
        : "No matching windows"

      const empty = new Gtk.Label({ label: message, visible: true })
      empty.get_style_context().add_class("launcher-empty")
      resultsBox.add(empty)
    } else {
      currentResults.forEach((item: any) => {
        const widget = buildResultItem(item, mode)
        resultsBox!.add(widget)
      })
    }

    resultsBox.show_all()
    updateSelection(currentSelected)
  }

  createEffect(() => {
    updateResults(tab(), query())
  })

  createEffect(() => {
    updateSelection(selected())
  })

  const unsubscribeClients = clients.subscribe(() => {
    const mode = tab()
    if (mode === "windows") updateResults(mode, query())
  })

  onCleanup(() => {
    unsubscribeClients()
    publishLauncherVisibility(false)
    entryRef = null
    revealerRef = null
    resultsScroll = null
  })

  return (
    <window
      name="app-launcher"
      class="AppLauncher"
      visible={false}
      keymode={Astal.Keymode.EXCLUSIVE}
      anchor={Astal.WindowAnchor.TOP
        | Astal.WindowAnchor.BOTTOM
        | Astal.WindowAnchor.LEFT
        | Astal.WindowAnchor.RIGHT}
      exclusivity={Astal.Exclusivity.IGNORE}
      application={app}
      $={(self: any) => {
        trackEscapeDismiss(self, close)
        const screen = self.get_screen()
        const visual = screen?.get_rgba_visual()
        if (visual) self.set_visual(visual)
        self.connect('notify::visible', () => {
          const visible = self.get_visible()
          publishLauncherVisibility(visible)
          if (!visible) return
          const geo = placeWindowAtPointer(self)
          rootWidget?.set_size_request(Math.max(360, Math.min(600, geo.width - 32)), -1)
        })
        self.connect('destroy', () => publishLauncherVisibility(false))
      }}
      onKeyPressEvent={handleKey}
    >
      <eventbox
        visible={true}
        hexpand={true}
        vexpand={true}
        $={(self: Gtk.EventBox) => {
          self.connect('button-press-event', () => {
            close()
            return true
          })
        }}
      >
        <eventbox
          class="launcher-hitbox"
          visible={true}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.START}
          margin_top={38}
          $={(self: Gtk.EventBox) => {

            self.connect('button-press-event', () => true)
          }}
        >
          <revealer
            transitionType={Gtk.RevealerTransitionType.CROSSFADE}
            transitionDuration={120}
            revealChild={false}
            $={(self: Gtk.Revealer) => { revealerRef = self }}
          >
            <box
              class="launcher-root"
              orientation={Gtk.Orientation.VERTICAL}
              spacing={0}
              $={(self: Gtk.Widget) => { rootWidget = self }}
            >
              <box
                class="launcher-search-row"
                orientation={Gtk.Orientation.HORIZONTAL}
                spacing={8}
              >
                <entry
                  class="launcher-entry"
                  text={DEFAULT_INPUT}
                  hexpand={true}
                  $={(self: Gtk.Entry) => {
                    entryRef = self
                    self.set_position(-1)
                    self.connect("changed", () => {
                      const parsed = parseInput(self.get_text() || "")
                      setTab(parsed.tab)
                      setQuery(parsed.query)
                      setSelected(0)
                    })
                  }}
                />
              </box>

              <box
                class="launcher-results-container"
                orientation={Gtk.Orientation.VERTICAL}
                $={(self: Gtk.Box) => {
                  resultsScroll = new Gtk.ScrolledWindow({
                    visible: true,
                    hscrollbar_policy: Gtk.PolicyType.NEVER,
                    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
                  })
                  resultsScroll.set_propagate_natural_height(false)
                  const initialHeight = resultsViewportHeight()
                  resultsScroll.set_min_content_height(initialHeight)
                  resultsScroll.set_max_content_height(initialHeight)
                  resultsScroll.set_size_request(-1, initialHeight)

                  resultsBox = new Gtk.Box({
                    orientation: Gtk.Orientation.VERTICAL,
                    spacing: RESULT_GAP,
                    visible: true,
                  })
                  resultsBox.get_style_context().add_class("launcher-results")

                  resultsScroll.add(resultsBox)
                  self.add(resultsScroll)
                  self.show_all()

                  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    updateResults(tab(), query())
                    return GLib.SOURCE_REMOVE
                  })
                }}
              />
            </box>
          </revealer>
        </eventbox>
      </eventbox>
    </window>
  )
}
