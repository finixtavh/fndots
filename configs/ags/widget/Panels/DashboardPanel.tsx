// Dashboard Panel
import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import GObject from "gi://GObject"
import GdkPixbuf from "gi://GdkPixbuf"
import Pango from "gi://Pango"
import { execAsync } from "ags/process"
import { readLog, clearLog, subscribeLogs, LogCat, LogEntry, derr } from "../Helpers/DashLog"
import { fnDebugEnabled } from "../Helpers/FnLogCollector"
import { AGS_CACHE_DIR, AGS_CONFIG_DIR, FNWALL_DIR, STATE_HOME } from "../Helpers/Paths"
import { placeWindowAtPointer } from "../Helpers/Monitor"
import { trackEscapeDismiss } from "../Helpers/FlyoutState"
import { iconImage, IC } from "../Helpers/Icons"

const EMOJI_DATA_FILE = GLib.build_filenamev([AGS_CONFIG_DIR, 'widget', 'Panels', 'emoji-data.json'])

type DashboardPage = 'wallman' | 'cliphist' | 'emoji' | 'logs'
const DASHBOARD_PAGE_INDEX: Record<DashboardPage, number> = {
  wallman: 0,
  cliphist: 1,
  emoji: 2,
  logs: 3,
}
let selectDashboardPage: ((index: number) => void) | null = null
let pendingDashboardPage: number | null = null
let dashboardInitialized = false
let dashboardCompactLayout = false
const dashboardLayoutHooks = new Set<(compact: boolean) => void>()

export function showDashboardPage(page: DashboardPage): void {
  pendingDashboardPage = DASHBOARD_PAGE_INDEX[page]
  const win = app.get_window('dashboard')
  if (!win) return
  win.set_visible(true)

  if (dashboardInitialized && pendingDashboardPage != null && selectDashboardPage) {
    selectDashboardPage(pendingDashboardPage)
    pendingDashboardPage = null
  }
}

const WALL_DIR   = GLib.build_filenamev([FNWALL_DIR, 'wallpapers'])
const WALLPICKER = GLib.build_filenamev([FNWALL_DIR, 'wallpicker.sh'])
const WALL_THUMB = GLib.build_filenamev([AGS_CACHE_DIR, 'wall-thumbs'])
const CLIP_THUMB = GLib.build_filenamev([AGS_CACHE_DIR, 'cliphist-thumbs'])
const WALL_STATE = GLib.build_filenamev([STATE_HOME, 'fnwall', 'current'])

const VIDEO_RE = /\.(mp4|mkv|webm|avi|mov|m4v)$/i
const IMAGE_RE = /\.(png|jpe?g|gif|bmp|webp)$/i
const THUMB_W  = 184
const THUMB_H  = 103

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const sanitizeKey = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_')

function execWithStdin(argv: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const proc = Gio.Subprocess.new(
        argv,
        Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
      )
      proc.communicate_utf8_async(input, null, (_process, result) => {
        try {
          const [, stdout, stderr] = proc.communicate_utf8_finish(result)
          if (!proc.get_successful()) return reject(new Error((stderr || 'Command failed').trim()))
          resolve(stdout ?? '')
        } catch (error) { reject(error) }
      })
    } catch (error) { reject(error) }
  })
}

function setScaledImage(img: Gtk.Image, path: string, w = THUMB_W, h = THUMB_H) {
  try {
    const pb = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, w, h, true)
    img.set_from_pixbuf(pb)
  } catch (_) {
    img.set_from_icon_name('image-x-generic-symbolic', Gtk.IconSize.DIALOG)
    img.set_pixel_size(64)
  }
}

const _imgQueue: Array<{ img: Gtk.Image; path: string; w: number; h: number }> = []
let _imgPumpId: any = null
const IMG_PER_TICK = 2
function queueScaledImage(img: Gtk.Image, path: string, w = THUMB_W, h = THUMB_H) {
  _imgQueue.push({ img, path, w, h })
  if (_imgPumpId != null) return
  _imgPumpId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    for (let i = 0; i < IMG_PER_TICK; i++) {
      const job = _imgQueue.shift()
      if (!job) { _imgPumpId = null; return GLib.SOURCE_REMOVE }

      try { setScaledImage(job.img, job.path, job.w, job.h) } catch (_) {}
    }
    return GLib.SOURCE_CONTINUE
  })
}

function loadThumb(
  file: string,
  img: Gtk.Image,
  video: boolean,
  width = THUMB_W,
  height = THUMB_H,
  fit: 'cover' | 'contain' = 'cover',
) {

  const key = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, file, -1)
  const thumb = `${WALL_THUMB}/${key}-${width}x${height}-${fit}.jpg`

  if (GLib.file_test(thumb, GLib.FileTest.EXISTS)) {
    queueScaledImage(img, thumb, width, height)
    return
  }

  img.set_from_icon_name(video ? 'video-x-generic-symbolic' : 'image-x-generic-symbolic', Gtk.IconSize.DIALOG)
  img.set_pixel_size(48)

  const seek = video ? '-ss 1 ' : ''
  const vf = fit === 'contain'
    ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
    : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
  const cmd = `mkdir -p ${shq(WALL_THUMB)} && ffmpeg -y ${seek}-i ${shq(file)} -frames:v 1 -vf ${shq(vf)} ${shq(thumb)} >/dev/null 2>&1`
  execAsync(['bash', '-c', cmd])
    .then(() => { if (GLib.file_test(thumb, GLib.FileTest.EXISTS)) queueScaledImage(img, thumb, width, height) })
    .catch((e: any) => derr('[DashboardPanel:thumb]', e))
}

function readCurrentWallpaper(): string | null {
  try {
    const [ok, raw] = GLib.file_get_contents(WALL_STATE)
    if (!ok) return null
    const path = new TextDecoder().decode(raw).trim()
    return path && GLib.file_test(path, GLib.FileTest.IS_REGULAR) ? path : null
  } catch (_) { return null }
}

function wallTile(file: string, apply: (f: string) => void): Gtk.Widget {
  const name = GLib.path_get_basename(file)
  const btn = new Gtk.Button({ visible: true })
  ;(btn as any)._wallName = name
  btn.get_style_context().add_class('wall-tile')
  btn.set_relief(Gtk.ReliefStyle.NONE)

  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })

  const img = new Gtk.Image({ visible: true })
  img.get_style_context().add_class('wall-thumb')
  img.set_size_request(THUMB_W, THUMB_H)
  box.add(img)

  const nameLbl = new Gtk.Label({ label: name, visible: true, xalign: 0 })
  nameLbl.get_style_context().add_class('wall-name')
  nameLbl.set_ellipsize(Pango.EllipsizeMode.MIDDLE)
  nameLbl.set_max_width_chars(20)
  nameLbl.set_width_chars(20)
  nameLbl.set_single_line_mode(true)
  box.add(nameLbl)

  loadThumb(file, img, VIDEO_RE.test(file))

  btn.add(box)
  btn.connect('clicked', () => apply(file))
  return btn
}

function buildFnWallPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, visible: true })
  page.get_style_context().add_class('settings-page')
  page.get_style_context().add_class('fnwall-page')

  const headRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const headCopy = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, visible: true, hexpand: true })
  const head = new Gtk.Label({ label: 'FNWall', visible: true, xalign: 0 })
  head.get_style_context().add_class('settings-section')
  headCopy.add(head)

  const hint = new Gtk.Label({
    label: 'Choose a frame to apply it. New and removed files appear automatically.',
    visible: true, xalign: 0,
  })
  hint.get_style_context().add_class('settings-hint')
  hint.set_line_wrap(true)
  headCopy.add(hint)
  headRow.add(headCopy)

  const countLabel = new Gtk.Label({ label: 'CHECKING FOLDER…', visible: true, xalign: 1 })
  countLabel.get_style_context().add_class('fnwall-count')
  headRow.add(countLabel)
  page.add(headRow)

  const library = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, visible: true, hexpand: true, vexpand: true })
  library.get_style_context().add_class('fnwall-library')
  const libraryHead = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
  const libraryTitle = new Gtk.Label({ label: 'Live folder', visible: true, xalign: 0, hexpand: true })
  libraryTitle.get_style_context().add_class('fnwall-library-title')
  libraryHead.add(libraryTitle)
  const librarySort = new Gtk.Label({ label: 'Sorted A—Z', visible: true, xalign: 1 })
  librarySort.get_style_context().add_class('fnwall-library-sort')
  libraryHead.add(librarySort)
  library.add(libraryHead)

  const scroll = new Gtk.ScrolledWindow({ visible: true, hexpand: true, vexpand: true })
  scroll.get_style_context().add_class('settings-content')
  scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  library.add(scroll)

  const empty = new Gtk.Label({ label: 'No supported wallpapers were found.', visible: false, xalign: 0 })
  empty.get_style_context().add_class('fnwall-empty')
  empty.set_no_show_all(true)
  library.add(empty)
  page.add(library)

  const flow = new Gtk.FlowBox({ visible: true, homogeneous: true })
  flow.set_valign(Gtk.Align.START)
  flow.set_selection_mode(Gtk.SelectionMode.NONE)
  flow.set_max_children_per_line(3)
  flow.set_min_children_per_line(1)
  flow.set_row_spacing(10)
  flow.set_column_spacing(10)
  flow.get_style_context().add_class('wall-flow')

  flow.set_sort_func((a: any, b: any) =>
    String(a.get_child()?._wallName ?? '').localeCompare(String(b.get_child()?._wallName ?? '')))
  scroll.add(flow)

  const tiles   = new Map<string, Gtk.Widget>()
  let   desired = new Set<string>()
  const pending = new Set<string>()
  const buildQ: string[] = []
  let   buildId: any = null
  let   currentFile: string | null = readCurrentWallpaper()

  const showCurrent = (file: string | null) => {
    currentFile = file && GLib.file_test(file, GLib.FileTest.IS_REGULAR) ? file : null
    for (const [path, tile] of tiles) {
      const context = tile.get_style_context()
      if (path === currentFile) context.add_class('current')
      else context.remove_class('current')
    }
  }

  const apply = (file: string) => {
    librarySort.set_label('APPLYING…')
    librarySort.set_tooltip_text(GLib.path_get_basename(file))
    execAsync(['bash', WALLPICKER, file])
      .then(() => {
        showCurrent(file)
        librarySort.set_label('Sorted A—Z')
        librarySort.set_tooltip_text(null)
      })
      .catch(() => {
        librarySort.set_label('APPLY FAILED · RETRY')
        librarySort.set_tooltip_text(GLib.path_get_basename(file))
      })
  }

  const syncFnWallLayout = (compact: boolean) => {
    const context = page.get_style_context()
    if (compact) context.add_class('compact')
    else context.remove_class('compact')
  }
  dashboardLayoutHooks.add(syncFnWallLayout)
  syncFnWallLayout(dashboardCompactLayout)

  const pumpBuild = () => {
    if (buildId != null) return
    buildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 12, () => {
      let made = 0
      while (made < 2) {
        const p = buildQ.shift()
        if (p === undefined) { buildId = null; return GLib.SOURCE_REMOVE }
        pending.delete(p)
        if (!desired.has(p) || tiles.has(p)) continue
        const t = wallTile(p, apply)
        if (p === currentFile) t.get_style_context().add_class('current')
        tiles.set(p, t)
        flow.add(t)
        t.show_all()
        made++
      }
      flow.invalidate_sort()
      return GLib.SOURCE_CONTINUE
    })
  }

  const populate = () => {
    const want: string[] = []
    try {
      const d = GLib.Dir.open(WALL_DIR, 0)
      let n = d.read_name()
      while (n) {
        if (VIDEO_RE.test(n) || IMAGE_RE.test(n)) want.push(`${WALL_DIR}/${n}`)
        n = d.read_name()
      }
      d.close()
    } catch (_) {
      countLabel.set_label('FOLDER UNAVAILABLE')
      empty.set_label('The wallpaper folder is unavailable.')
      empty.show()
      scroll.hide()
      return
    }
    countLabel.set_label(`${want.length} ${want.length === 1 ? 'FILE' : 'FILES'}`)
    if (want.length) { empty.hide(); scroll.show() }
    else { scroll.hide(); empty.show() }
    desired = new Set(want)
    for (const [p, tile] of tiles) {
      if (!desired.has(p)) { try { flow.remove(tile); tile.destroy() } catch (_) {} tiles.delete(p) }
    }
    for (const p of want) {
      if (!tiles.has(p) && !pending.has(p)) { pending.add(p); buildQ.push(p) }
    }
    pumpBuild()
    const saved = readCurrentWallpaper()
    if (saved !== currentFile) showCurrent(saved)
  }

  showCurrent(currentFile)
  populate()

  let dirty = false
  let debounceId: any = null
  const scheduleRefresh = () => {
    if (debounceId) GLib.source_remove(debounceId)
    debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
      debounceId = null
      if (page.get_mapped()) populate(); else dirty = true
      return GLib.SOURCE_REMOVE
    })
  }
  let monitor: any = null
  try {
    monitor = Gio.File.new_for_path(WALL_DIR).monitor_directory(Gio.FileMonitorFlags.NONE, null)
    monitor.connect('changed', scheduleRefresh)
  } catch (_) {}
  let stateMonitor: any = null
  try {
    stateMonitor = Gio.File.new_for_path(GLib.path_get_dirname(WALL_STATE)).monitor_directory(Gio.FileMonitorFlags.NONE, null)
    stateMonitor.connect('changed', () => {
      const saved = readCurrentWallpaper()
      if (saved !== currentFile) showCurrent(saved)
    })
  } catch (_) {}
  page.connect('map', () => {
    const saved = readCurrentWallpaper()
    if (saved !== currentFile) showCurrent(saved)
    if (dirty) { dirty = false; populate() }
  })
  page.connect('destroy', () => {
    dashboardLayoutHooks.delete(syncFnWallLayout)
    if (debounceId) { GLib.source_remove(debounceId); debounceId = null }
    if (buildId != null) { GLib.source_remove(buildId); buildId = null }
    try { monitor?.cancel() } catch (_) {}
    try { stateMonitor?.cancel() } catch (_) {}
  })

  return page
}

function cliphistRow(id: string, preview: string, rawLine: string, onCopied: () => void): Gtk.Widget {
  const row = new Gtk.Button({ visible: true })
  row.get_style_context().add_class('cliphist-row')
  row.set_relief(Gtk.ReliefStyle.NONE)

  const hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10, visible: true })

  const imgMatch = /\bbinary data\b.*\b(png|jpe?g|gif|bmp|webp)\b/i.exec(preview)
  if (imgMatch) {
    const thumb = new Gtk.Image({ visible: true })
    thumb.get_style_context().add_class('cliphist-thumb')
    thumb.set_size_request(72, 40)
    thumb.set_from_icon_name('image-loading-symbolic', Gtk.IconSize.DND)
    const dest = `${CLIP_THUMB}/${sanitizeKey(id)}.bin`
    if (GLib.file_test(dest, GLib.FileTest.EXISTS)) {

      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => { setScaledImage(thumb, dest, 72, 40); return GLib.SOURCE_REMOVE })
    } else {
      const cmd = 'mkdir -p -m700 -- "$1" && chmod 700 -- "$1"; '
        + 'tmp=$(mktemp "$1/.clip.XXXXXX") || exit; '
        + 'trap \'rm -f -- "$tmp"\' EXIT; cliphist decode > "$tmp" && '
        + 'chmod 600 "$tmp" && mv -- "$tmp" "$2"; trap - EXIT'
      execWithStdin(['bash', '-c', cmd, 'cliphist-thumb', CLIP_THUMB, dest], rawLine)
        .then(() => { if (GLib.file_test(dest, GLib.FileTest.EXISTS)) setScaledImage(thumb, dest, 72, 40) })
        .catch((e: any) => derr('[DashboardPanel:cliphist-thumb]', e))
    }
    hbox.add(thumb)

    const dims = /(\d+x\d+)/.exec(preview)?.[1] ?? ''
    const lbl = new Gtk.Label({ label: `Image  ${imgMatch[1].toUpperCase()}  ${dims}`.trim(), visible: true, xalign: 0 })
    lbl.get_style_context().add_class('cliphist-text')
    lbl.set_hexpand(true)
    hbox.add(lbl)
  } else {
    const lbl = new Gtk.Label({ label: preview, visible: true, xalign: 0 })
    lbl.get_style_context().add_class('cliphist-text')
    lbl.set_hexpand(true)
    lbl.set_ellipsize(Pango.EllipsizeMode.END)
    lbl.set_single_line_mode(true)
    hbox.add(lbl)
  }

  row.add(hbox)

  row.connect('clicked', () => {

    execWithStdin(['bash', '-c', 'cliphist decode | wl-copy >/dev/null 2>&1', 'cliphist-copy'], rawLine)
      .then(() => { GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => { onCopied(); return GLib.SOURCE_REMOVE }) })
      .catch((e: any) => derr('[DashboardPanel:cliphist-copy]', e))
  })
  return row
}

function buildCliphistPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, visible: true })
  page.get_style_context().add_class('settings-page')
  page.get_style_context().add_class('cliphist-page')

  const headRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const head = new Gtk.Label({ label: 'Clipboard history', visible: true, xalign: 0 })
  head.get_style_context().add_class('settings-section')
  head.set_hexpand(true)
  headRow.add(head)

  const clearBtn = new Gtk.Button({ label: 'Clear all history', visible: true })
  clearBtn.get_style_context().add_class('settings-clear-btn')
  clearBtn.get_style_context().add_class('cliphist-clear-btn')
  headRow.add(clearBtn)
  page.add(headRow)

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const scroll = new Gtk.ScrolledWindow({ visible: true, hexpand: true, vexpand: true })
  scroll.get_style_context().add_class('settings-content')
  scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  page.add(scroll)

  const list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
  scroll.add(list)

  let refreshGeneration = 0
  let rowPumpId: number | null = null
  let destroyed = false

  const refresh = () => {
    const generation = ++refreshGeneration
    if (rowPumpId != null) { GLib.source_remove(rowPumpId); rowPumpId = null }
    list.get_children().forEach(c => c.destroy())
    execAsync(['cliphist', 'list'])
      .then((out: string) => {
        if (destroyed || generation !== refreshGeneration) return
        const lines = out.split('\n').filter(Boolean)
        if (!lines.length) {
          const empty = new Gtk.Label({ label: 'Clipboard history is empty.', visible: true, xalign: 0 })
          empty.get_style_context().add_class('settings-hint')
          list.add(empty)
          return
        }

        const parsed = lines
          .map(line => { const t = line.indexOf('\t'); return t < 0 ? null : { id: line.slice(0, t), preview: line.slice(t + 1), line } })
          .filter((p): p is { id: string; preview: string; line: string } => p !== null)
        let ci = 0
        rowPumpId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 6, () => {
          if (destroyed || generation !== refreshGeneration) {
            rowPumpId = null
            return GLib.SOURCE_REMOVE
          }
          const end = Math.min(ci + 12, parsed.length)
          for (; ci < end; ci++) { const p = parsed[ci]; list.add(cliphistRow(p.id, p.preview, p.line, refresh)) }
          list.show_all()
          if (ci >= parsed.length) { rowPumpId = null; return GLib.SOURCE_REMOVE }
          return GLib.SOURCE_CONTINUE
        })
      })
      .catch(() => {
        if (destroyed || generation !== refreshGeneration) return
        const err = new Gtk.Label({ label: 'cliphist not available.', visible: true, xalign: 0 })
        err.get_style_context().add_class('settings-hint')
        list.add(err)
        list.show_all()
      })
  }

  let armed: number | null = null
  clearBtn.connect('clicked', () => {
    if (clearBtn.get_label() !== 'Clear all history') {
      if (armed) { GLib.source_remove(armed); armed = null }
      clearBtn.set_label('Clear all history')
      clearBtn.get_style_context().remove_class('settings-danger-armed')
      execAsync(['cliphist', 'wipe']).then(refresh).catch((e: any) => derr('[DashboardPanel:cliphist-wipe]', e))
    } else {
      clearBtn.set_label('Confirm wipe?')
      clearBtn.get_style_context().add_class('settings-danger-armed')
      armed = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        clearBtn.set_label('Clear all history')
        clearBtn.get_style_context().remove_class('settings-danger-armed')
        armed = null
        return GLib.SOURCE_REMOVE
      })
    }
  })

  page.connect('destroy', () => {
    destroyed = true
    refreshGeneration++
    if (rowPumpId != null) { GLib.source_remove(rowPumpId); rowPumpId = null }
    if (armed != null) { GLib.source_remove(armed); armed = null }
  })

  refresh()
  return page
}

const LEVEL_COLOR: Record<string, string> = {
  req:    '#7A7A7A',
  lyr:    '#a6e3a1',
  cache:  '#89b4fa',
  nolyr:  '#f9e2af',
  neterr: '#f38ba8',
  log:    '#C8C8C8',
  message:'#89b4fa',
  debug:  '#7A7A7A',
  warn:   '#fab387',
  error:  '#f38ba8',

  ok: '#a6e3a1', miss: '#f9e2af', skip: '#7A7A7A', err: '#f38ba8',
}

const LEVEL_LABEL: Record<string, string> = {
  req: 'REQ', lyr: 'LYR', cache: 'MISS/CACHE', nolyr: 'MISS/NOLYR', neterr: 'NET ERR',
  log: 'LOG', message: 'MESSAGE', debug: 'LOG',
}

const FN_LEVEL_LABEL: Record<string, string> = {
  log: 'Log', message: 'Message', debug: 'Log', warn: 'Warn', error: 'Error', err: 'Error',
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function logRow(e: LogEntry, cat: LogCat): Gtk.Widget {
  const row = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
  row.get_style_context().add_class('log-row')

  const top = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10, visible: true })

  const time = new Gtk.Label({ label: fmtTime(e.t), visible: true, xalign: 0 })
  time.get_style_context().add_class('log-time')
  top.add(time)

  const badge = new Gtk.Label({ visible: true, xalign: 0 })
  badge.set_use_markup(true)
  const color = LEVEL_COLOR[e.level] ?? '#C8C8C8'
  const label = LEVEL_LABEL[e.level] ?? e.level.toUpperCase()
  badge.set_markup(`<span foreground="${color}"><b>${label}</b></span>`)
  badge.set_size_request(94, -1)
  top.add(badge)

  const text = cat === 'fn'
    ? `[${e.source ?? 'AGS'}/${FN_LEVEL_LABEL[e.level] ?? 'Log'}]: ${e.msg}`
    : e.msg
  const msg = new Gtk.Label({ label: text, visible: true, xalign: 0 })
  msg.get_style_context().add_class('log-msg')
  msg.set_hexpand(true)
  msg.set_ellipsize(Pango.EllipsizeMode.END)
  msg.set_single_line_mode(true)
  if (e.detail) msg.set_tooltip_text(e.detail)
  top.add(msg)
  row.add(top)

  if (e.detail) {
    const det = new Gtk.Label({ label: e.detail, visible: true, xalign: 0 })
    det.get_style_context().add_class('log-detail')
    det.set_ellipsize(Pango.EllipsizeMode.END)
    det.set_single_line_mode(true)
    row.add(det)
  }
  return row
}

function buildLogsPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 10, visible: true })
  page.get_style_context().add_class('settings-page')
  page.get_style_context().add_class('logs-page')

  const cats: LogCat[]    = ['fn', 'lrclib', 'ytdlp']
  const labels: string[]  = ['FN-Logs', 'lrclib.net', 'yt-dlp/MusicBar']
  let cur = 0

  const tabRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6, visible: true })
  const tabBtns: Gtk.Button[] = []
  page.add(tabRow)

  const clearBtn = new Gtk.Button({ label: 'Clear this log', visible: true })
  clearBtn.get_style_context().add_class('settings-clear-btn')

  page.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

  const debugHint = new Gtk.Label({
    label: fnDebugEnabled()
      ? 'Debug mode active: collecting Hyprland, Hyprlock, AGS, GJS and Astal logs.'
      : 'Debug mode disabled: no external log collectors are running.',
    visible: true, xalign: 0,
  })
  debugHint.get_style_context().add_class('settings-hint')
  page.add(debugHint)

  const scroll = new Gtk.ScrolledWindow({ visible: true, hexpand: true, vexpand: true })
  scroll.get_style_context().add_class('settings-content')
  scroll.set_policy(Gtk.PolicyType.AUTOMATIC, Gtk.PolicyType.AUTOMATIC)
  page.add(scroll)

  const textView = new Gtk.TextView({ visible: true, editable: false, cursor_visible: true })
  textView.get_style_context().add_class('dash-log-text')
  textView.set_monospace(true)
  textView.set_wrap_mode(Gtk.WrapMode.NONE)
  textView.set_left_margin(10)
  textView.set_right_margin(10)
  textView.set_top_margin(8)
  textView.set_bottom_margin(8)
  scroll.add(textView)

  let renderDebounceId: number | null = null
  const render = () => {
    if (renderDebounceId != null) {
      GLib.source_remove(renderDebounceId)
      renderDebounceId = null
    }
    const entries = readLog(cats[cur])
    const lines = entries.slice(-400).reverse().flatMap(entry => {
      const time = new Date(entry.t).toLocaleTimeString([], { hour12: false })
      const level = LEVEL_LABEL[entry.level] ?? entry.level.toUpperCase()
      const source = cats[cur] === 'fn' ? ` [${entry.source ?? 'AGS'}]` : ''
      const primary = `[${time}] [${level}]${source} ${entry.msg}`
      return entry.detail ? [primary, `    ${entry.detail}`] : [primary]
    })
    textView.get_buffer().set_text(lines.length ? lines.join('\n') : 'No entries yet.', -1)
  }
  const scheduleRender = () => {
    if (renderDebounceId != null) return
    renderDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 75, () => {
      renderDebounceId = null
      render()
      return GLib.SOURCE_REMOVE
    })
  }
  page.connect('destroy', () => {
    if (renderDebounceId != null) {
      GLib.source_remove(renderDebounceId)
      renderDebounceId = null
    }
  })

  labels.forEach((lbl, i) => {
    const b = new Gtk.Button({ label: lbl, visible: true })
    b.get_style_context().add_class('dash-subtab')
    b.set_relief(Gtk.ReliefStyle.NONE)
    b.connect('clicked', () => {
      cur = i
      tabBtns.forEach(x => x.get_style_context().remove_class('active'))
      b.get_style_context().add_class('active')
      render()
    })
    tabBtns.push(b)
    tabRow.add(b)
  })
  const spacer = new Gtk.Box({ visible: true, hexpand: true })
  tabRow.add(spacer)
  tabRow.add(clearBtn)
  tabBtns[0].get_style_context().add_class('active')

  clearBtn.connect('clicked', () => clearLog(cats[cur]))

  const unsubLogs = subscribeLogs((c) => { if (c === cats[cur]) scheduleRender() })
  page.connect('destroy', unsubLogs)

  render()
  return page
}

interface EmojiEntry { e: string; n: string; c: number; a: string[]; t: string[] }
interface EmojiData  { groups: string[]; emojis: EmojiEntry[] }

function loadEmojiData(): EmojiData | null {
  try {
    const [ok, raw] = GLib.file_get_contents(EMOJI_DATA_FILE)
    if (!ok) return null
    const j = JSON.parse(new TextDecoder().decode(raw))
    return Array.isArray(j.emojis) ? j : null
  } catch (_) { return null }
}

function buildEmojiPage(): Gtk.Box {
  const page = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8, visible: true })
  page.get_style_context().add_class('settings-page')
  page.get_style_context().add_class('emoji-page')

  const pageHead = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 12, visible: true })
  const headCopy = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, visible: true, hexpand: true })
  const head = new Gtk.Label({ label: 'Emoji', visible: true, xalign: 0 })
  head.get_style_context().add_class('settings-section')
  headCopy.add(head)
  const headHint = new Gtk.Label({ label: 'Browse by group or compose with :shortcodes:.', visible: true, xalign: 0 })
  headHint.get_style_context().add_class('settings-hint')
  headCopy.add(headHint)
  pageHead.add(headCopy)
  page.add(pageHead)

  const data = loadEmojiData()
  if (!data) {
    const err = new Gtk.Label({ label: 'emoji-data.json not found.', visible: true, xalign: 0 })
    err.get_style_context().add_class('settings-hint')
    page.add(err)
    return page
  }

  const byAlias = new Map<string, string>()
  for (const em of data.emojis) for (const a of em.a) if (!byAlias.has(a)) byAlias.set(a, em.e)

  const copy = (emoji: string) => {

    execWithStdin(['bash', '-c', 'wl-copy >/dev/null 2>&1', 'emoji-copy'], emoji).catch(() => {})
    execAsync(['notify-send', 'Emoji', `Copied  ${emoji}`, '-a', 'Emoji', '-t', '1200']).catch(() => {})
  }

  const emojiWorkspace = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, visible: true, hexpand: true, vexpand: true })
  emojiWorkspace.get_style_context().add_class('emoji-workbench')
  page.add(emojiWorkspace)

  const categoryNav = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
  categoryNav.get_style_context().add_class('emoji-category-nav')
  categoryNav.set_size_request(148, -1)
  emojiWorkspace.pack_start(categoryNav, false, false, 0)

  const scroll = new Gtk.ScrolledWindow({ visible: true, hexpand: true, vexpand: true })
  scroll.get_style_context().add_class('settings-content')
  scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
  emojiWorkspace.pack_start(scroll, true, true, 0)

  const groupStack = new Gtk.Stack({ visible: true, hexpand: true, vexpand: true })
  groupStack.set_transition_type(Gtk.StackTransitionType.CROSSFADE)
  groupStack.set_transition_duration(120)
  scroll.add(groupStack)

  const emojiQueue: { flow: Gtk.FlowBox; em: EmojiEntry }[] = []
  const categoryBtns: Gtk.Button[] = []
  const groupedEmoji = data.groups.map(() => [] as EmojiEntry[])
  for (const em of data.emojis) groupedEmoji[em.c]?.push(em)
  let firstGroup: string | null = null
  data.groups.forEach((groupName, gi) => {
    const members = groupedEmoji[gi]
    if (!members.length) return

    const groupKey = String(gi)
    if (firstGroup == null) firstGroup = groupKey
    const groupPage = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true, hexpand: true, vexpand: true })
    groupPage.get_style_context().add_class('emoji-group-page')

    const flow = new Gtk.FlowBox({ visible: true, homogeneous: true })
    flow.get_style_context().add_class('emoji-flow')
    flow.set_valign(Gtk.Align.START)
    flow.set_selection_mode(Gtk.SelectionMode.NONE)
    flow.set_max_children_per_line(12)
    flow.set_min_children_per_line(5)
    groupPage.add(flow)
    groupStack.add_named(groupPage, groupKey)

    const categoryBtn = new Gtk.Button({ label: groupName, visible: true })
    categoryBtn.get_style_context().add_class('emoji-category-btn')
    categoryBtn.set_relief(Gtk.ReliefStyle.NONE)
    categoryBtn.connect('clicked', () => {
      groupStack.set_visible_child_name(groupKey)
      categoryBtns.forEach(button => button.get_style_context().remove_class('active'))
      categoryBtn.get_style_context().add_class('active')
    })
    categoryBtns.push(categoryBtn)
    categoryNav.add(categoryBtn)
    for (const em of members) emojiQueue.push({ flow, em })
  })
  if (firstGroup != null) {
    groupStack.set_visible_child_name(firstGroup)
    categoryBtns[0]?.get_style_context().add_class('active')
  }

  const mkEmojiBtn = (em: EmojiEntry): Gtk.Button => {
    const btn = new Gtk.Button({ label: em.e, visible: true })
    btn.get_style_context().add_class('emoji-btn')
    btn.set_relief(Gtk.ReliefStyle.NONE)
    btn.set_tooltip_text(`${em.n}${em.a.length ? `  :${em.a[0]}:` : ''}`)
    btn.connect('clicked', () => copy(em.e))
    return btn
  }

  let qi = 0

  let gridPumpId: any = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    const end = Math.min(qi + 200, emojiQueue.length)
    for (; qi < end; qi++) {
      const p = emojiQueue[qi]

      const child = new Gtk.FlowBoxChild({ visible: true })
      child.add(mkEmojiBtn(p.em))
      p.flow.add(child)
    }
    if (qi >= emojiQueue.length) { gridPumpId = null; return GLib.SOURCE_REMOVE }
    return GLib.SOURCE_CONTINUE
  })

  const inputWrap = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4, visible: true })
  inputWrap.get_style_context().add_class('emoji-input-wrap')

  const hint = new Gtk.Label({
    label: 'Type  :shortcode:  to insert an emoji (autocompletes). Enter or Copy to clipboard.',
    visible: true, xalign: 0,
  })
  hint.get_style_context().add_class('settings-hint')
  inputWrap.add(hint)

  const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, visible: true })
  const entry = new Gtk.Entry({ visible: true, hexpand: true })
  entry.get_style_context().add_class('emoji-input')
  entry.set_placeholder_text('e.g.  :wilted_flower: hi :fire:')
  row.add(entry)
  const copyBtn = new Gtk.Button({ label: 'Copy', visible: true })
  copyBtn.get_style_context().add_class('settings-clear-btn')
  row.add(copyBtn)
  inputWrap.add(row)
  page.add(inputWrap)

  const getToken = (): { colon: number; pos: number; cps: string[]; frag: string } | null => {
    const pos = entry.get_position()
    const cps = Array.from(entry.get_text())
    let colon = -1
    for (let i = pos - 1; i >= 0; i--) {
      if (cps[i] === ':') { colon = i; break }
      if (!/[a-z0-9_+\-]/i.test(cps[i])) break
    }
    if (colon < 0) return null
    return { colon, pos, cps, frag: cps.slice(colon + 1, pos).join('').toLowerCase() }
  }

  let guard = false
  const replaceToken = (emoji: string) => {
    const tok = getToken()
    if (!tok) return
    const ins = Array.from(emoji)
    const next = [...tok.cps.slice(0, tok.colon), ...ins, ...tok.cps.slice(tok.pos)]
    guard = true
    entry.set_text(next.join(''))
    entry.set_position(tok.colon + ins.length)
    guard = false
  }

  entry.connect('changed', () => {
    if (guard) return
    const t = entry.get_text()
    const nt = t.replace(/:([a-z0-9_+\-]+):/g, (m, name) => byAlias.get(name) ?? m)
    if (nt !== t) { guard = true; entry.set_text(nt); entry.set_position(-1); guard = false }
  })

  const store = new Gtk.ListStore()
  store.set_column_types([GObject.TYPE_STRING, GObject.TYPE_STRING, GObject.TYPE_STRING])

  const aliasRows: Array<[string, string, string]> = []
  for (const em of data.emojis) for (const a of em.a) aliasRows.push([`${em.e}  :${a}:`, a, em.e])
  let si = 0
  let storePumpId: any = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 12, () => {
    const end = Math.min(si + 300, aliasRows.length)
    for (; si < end; si++) { const it = store.append(); store.set(it, [0, 1, 2], aliasRows[si]) }
    if (si >= aliasRows.length) { storePumpId = null; return GLib.SOURCE_REMOVE }
    return GLib.SOURCE_CONTINUE
  })

  page.connect('destroy', () => {
    if (gridPumpId  != null) { GLib.source_remove(gridPumpId);  gridPumpId  = null }
    if (storePumpId != null) { GLib.source_remove(storePumpId); storePumpId = null }
  })
  const comp = new Gtk.EntryCompletion({ model: store })
  comp.set_text_column(0)
  comp.set_minimum_key_length(1)
  comp.set_match_func((_c: any, _key: string, iter: any) => {
    const tok = getToken()
    if (!tok || tok.frag.length < 1) return false
    const alias = store.get_value(iter, 1) as string
    return alias.startsWith(tok.frag)
  })
  comp.connect('match-selected', (_c: any, model: any, iter: any) => {
    replaceToken(model.get_value(iter, 2) as string)
    return true
  })
  entry.set_completion(comp)

  const doCopy = () => {
    const txt = entry.get_text()
    if (txt) execWithStdin(['bash', '-c', 'wl-copy >/dev/null 2>&1', 'emoji-compose'], txt).catch(() => {})
  }
  entry.connect('activate', doCopy)
  copyBtn.connect('clicked', doCopy)

  return page
}

export default function DashboardPanel() {
  let win: Astal.Window
  let firstMap = true
  let openPage: (index: number) => void = () => {}
  let rootWidget: Gtk.Widget | null = null
  let applyResponsiveLayout: (compact: boolean) => void = () => {}
  const CENTER = Astal.WindowAnchor.NONE

  const close = () => { try { win?.set_visible(false) } catch (_) {} }

  const fitToPointerMonitor = () => {
    const geo = placeWindowAtPointer(win)
    dashboardCompactLayout = geo.width < 900
    rootWidget?.set_size_request(
      Math.max(360, Math.min(1180, geo.width - 48)),
      Math.max(420, Math.min(760, geo.height - 64)),
    )
    applyResponsiveLayout(dashboardCompactLayout)
  }

  return (
    <window
      $={(self: any) => {
        win = self
        trackEscapeDismiss(self, close)

        self.connect('map', () => {
          if (!firstMap) return
          firstMap = false
          openPage(pendingDashboardPage ?? 0)
          pendingDashboardPage = null
          dashboardInitialized = true
        })
        self.connect('destroy', () => {
          selectDashboardPage = null
          pendingDashboardPage = null
          dashboardInitialized = false
          applyResponsiveLayout = () => {}
        })
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
      name="dashboard"
      class="DashboardPanel"
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
      <box class="dash-root" orientation={Gtk.Orientation.HORIZONTAL} spacing={0}
        $={(root: any) => {
          rootWidget = root
          fitToPointerMonitor()

          const sidebar = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true,
          })
          sidebar.get_style_context().add_class('dash-tool-rail')
          sidebar.set_size_request(184, -1)
          root.pack_start(sidebar, false, false, 0)

          const brand = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 11, visible: true })
          brand.get_style_context().add_class('dash-brand')
          const brandIcon = iconImage('dashboard-fill', IC.accent, 24)
          brandIcon.get_style_context().add_class('dash-brand-icon')
          brand.add(brandIcon)
          const brandCopy = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 1, visible: true })
          brandCopy.set_valign(Gtk.Align.CENTER)
          const brandTitle = new Gtk.Label({ label: 'Dashboard', visible: true, xalign: 0 })
          brandTitle.get_style_context().add_class('dash-brand-title')
          brandCopy.add(brandTitle)
          brand.add(brandCopy)
          sidebar.add(brand)
          const brandDivider = new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true })
          sidebar.add(brandDivider)

          const nav = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true })
          nav.get_style_context().add_class('dash-tool-nav')
          sidebar.add(nav)

          const railSpacer = new Gtk.Box({ visible: true, vexpand: true })
          sidebar.add(railSpacer)

          const railDivider = new Gtk.Separator({ orientation: Gtk.Orientation.VERTICAL, visible: true })
          root.pack_start(railDivider, false, false, 0)

          const workspace = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true, hexpand: true, vexpand: true })
          workspace.get_style_context().add_class('dash-workspace')
          root.pack_start(workspace, true, true, 0)

          const commandStrip = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10, visible: true })
          commandStrip.get_style_context().add_class('dash-command-strip')
          const crumb = new Gtk.Label({ label: 'fn  /  dashboard', visible: true, xalign: 0, hexpand: true })
          crumb.get_style_context().add_class('dash-crumb')
          crumb.set_ellipsize(Pango.EllipsizeMode.MIDDLE)
          crumb.set_single_line_mode(true)
          commandStrip.add(crumb)
          workspace.add(commandStrip)
          workspace.add(new Gtk.Separator({ orientation: Gtk.Orientation.HORIZONTAL, visible: true }))

          const contentWrap = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true,
            hexpand: true, vexpand: true,
            margin_top: 20, margin_bottom: 16, margin_start: 24, margin_end: 24,
          })
          contentWrap.get_style_context().add_class('dash-content')
          workspace.add(contentWrap)

          const builders = [buildFnWallPage, buildCliphistPage, buildEmojiPage, buildLogsPage]
          const built    = [false, false, false, false]
          const slots: Gtk.Box[] = []
          const pagesBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: true, hexpand: true, vexpand: true })
          for (let i = 0; i < 4; i++) {
            const slot = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, visible: false, hexpand: true, vexpand: true })
            slots.push(slot)
            pagesBox.add(slot)
          }
          contentWrap.add(pagesBox)

          const navBtns: Gtk.Button[] = []
          const ensure = (idx: number) => {
            if (built[idx]) return
            built[idx] = true
            const page = builders[idx]()
            slots[idx].add(page)
            slots[idx].show_all()
          }
          const select = (idx: number) => {
            ensure(idx)
            navBtns.forEach((b, i) =>
              i === idx ? b.get_style_context().add_class('active')
                        : b.get_style_context().remove_class('active'))
            slots.forEach((s, i) => s.set_visible(i === idx))
            crumb.set_label(idx === 0 ? WALL_DIR : 'fn  /  dashboard')
            crumb.set_tooltip_text(idx === 0 ? WALL_DIR : null)
          }
          const makeNav = (label: string, iconName: string, idx: number) => {
            const btn = new Gtk.Button({ visible: true })
            btn.get_style_context().add_class('dash-nav-btn')
            btn.set_relief(Gtk.ReliefStyle.NONE)
            const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 10, visible: true })
            const icon = new Gtk.Image({ visible: true })
            icon.set_from_icon_name(iconName, Gtk.IconSize.BUTTON)
            icon.set_pixel_size(18)
            row.add(icon)
            const text = new Gtk.Label({ label, visible: true, xalign: 0, hexpand: true })
            text.set_ellipsize(Pango.EllipsizeMode.END)
            text.set_single_line_mode(true)
            row.add(text)
            btn.add(row)
            btn.connect('clicked', () => select(idx))
            navBtns.push(btn)
            nav.add(btn)
            return btn
          }
          makeNav('FNWall', 'preferences-desktop-wallpaper-symbolic', 0)
          makeNav('Cliphist', 'edit-paste-symbolic', 1)
          makeNav('Emoji', 'face-smile-symbolic', 2)
          makeNav('Logs', 'utilities-terminal-symbolic', 3)

          openPage = select
          selectDashboardPage = select

          applyResponsiveLayout = (compact: boolean) => {
            const rootContext = root.get_style_context()
            if (compact) rootContext.add_class('compact')
            else rootContext.remove_class('compact')

            root.set_orientation(compact ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL)
            sidebar.set_orientation(compact ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL)
            sidebar.set_size_request(compact ? -1 : 184, compact ? 58 : -1)
            railDivider.set_orientation(compact ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL)
            brandDivider.set_orientation(compact ? Gtk.Orientation.VERTICAL : Gtk.Orientation.HORIZONTAL)
            nav.set_orientation(compact ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL)
            brandCopy.set_visible(!compact)
            railSpacer.set_visible(!compact)
            navBtns.forEach(button => button.set_hexpand(compact))

            sidebar.set_child_packing(brand, false, false, 0, Gtk.PackType.START)
            sidebar.set_child_packing(brandDivider, false, false, 0, Gtk.PackType.START)
            sidebar.set_child_packing(nav, compact, true, 0, Gtk.PackType.START)
            contentWrap.set_margin_top(compact ? 16 : 20)
            contentWrap.set_margin_bottom(10)
            contentWrap.set_margin_start(compact ? 14 : 24)
            contentWrap.set_margin_end(compact ? 14 : 24)
            dashboardLayoutHooks.forEach(hook => hook(compact))
          }
          applyResponsiveLayout(dashboardCompactLayout)
        }}
      />
      </revealer>
    </window>
  )
}
