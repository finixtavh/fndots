// Icons
import GdkPixbuf from "gi://GdkPixbuf"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk3"
import { AGS_CONFIG_DIR } from "./Paths"

export const IC = {
  accent:    "#89B19E",
  secondary: "#C8C8C8",
  dim:       "#7A7A7A",
  primary:   "#E8E8E8",
  warn:      "#D9A066",
  red:       "#D08B8B",
}

const P: Record<string, string> = {
  launch:   '<g transform="scale(0.5)"><path fill="currentColor" stroke="none" d="M15.188 0.807c-1.354 3.313-2.167 5.484-3.672 8.703 0.922 0.979 2.057 2.12 3.896 3.406-1.979-0.818-3.328-1.635-4.339-2.484-1.927 4.026-4.948 9.75-11.073 20.76 4.818-2.781 8.547-4.495 12.026-5.151-0.146-0.641-0.234-1.333-0.229-2.063l0.005-0.151c0.078-3.089 1.682-5.458 3.583-5.297s3.38 2.792 3.307 5.88c-0.016 0.578-0.083 1.135-0.198 1.656 3.443 0.672 7.135 2.38 11.885 5.125-0.938-1.724-1.771-3.281-2.573-4.76-1.255-0.974-2.568-2.245-5.24-3.62 1.839 0.479 3.151 1.031 4.177 1.646-8.12-15.109-8.771-17.12-11.557-23.651z"/></g>',
  dropper:  '<g transform="scale(0.9412) translate(0 0.5)"><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M15.308,4.434 C16.22,3.523 16.118,1.939 15.079,0.9 C14.038,-0.139 12.455,-0.242 11.545,0.67 L10.364,1.853 L14.128,5.617 L15.308,4.434 L15.308,4.434 Z"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M5.468,14.276 L11.615,8.128 L12.387,8.9 L13.971,7.314 L8.662,2.005 L7.077,3.589 L7.85,4.362 L1.702,10.508 L0.02,15.201 L0.774,15.955 L5.468,14.276 L5.468,14.276 Z M8.916,5.428 L10.551,7.064 L4.289,13.324 L1.695,14.284 L2.654,11.688 L8.916,5.428 L8.916,5.428 Z"/></g>',
  clock:    '<circle cx="8" cy="8" r="5.6"/><path d="M8 4.6V8l2.5 1.6"/>',
  calendar: '<rect x="2.6" y="3.4" width="10.8" height="10" rx="1.6"/><path d="M2.6 6.4h10.8M5.8 2v2.6M10.2 2v2.6"/>',
  cpu:      '<rect x="4.6" y="4.6" width="6.8" height="6.8" rx="1.2"/><path d="M6.6 2v2.6M9.4 2v2.6M6.6 11.4V14M9.4 11.4V14M2 6.6h2.6M2 9.4h2.6M11.4 6.6H14M11.4 9.4H14"/>',
  ram:      '<rect x="2" y="5" width="12" height="6" rx="1"/><path d="M4.6 11v1.6M7 11v1.6M9 11v1.6M11.4 11v1.6M5 7.4v1.2M8 7.4v1.2M11 7.4v1.2"/>',
  vpn:      '<path d="M8 2.2 3 4.2v3.4c0 3 2.1 5.2 5 6.2 2.9-1 5-3.2 5-6.2V4.2L8 2.2Z"/><path d="M6 8l1.5 1.6L10.5 6.4"/>',
  bell:     '<path d="M5 11c-.55 0-.85-.62-.42-1.02.82-.78 1.22-1.6 1.22-3.18a2.2 2.2 0 0 1 4.4 0c0 1.58.4 2.4 1.22 3.18.43.4.13 1.02-.42 1.02H5Z"/><path d="M6.9 12.3a1.2 1.2 0 0 0 2.2 0"/>',
  "bell-off":'<path d="M5 11c-.55 0-.85-.62-.42-1.02.82-.78 1.22-1.6 1.22-3.18a2.2 2.2 0 0 1 4.4 0c0 1.58.4 2.4 1.22 3.18.43.4.13 1.02-.42 1.02H5Z"/><path d="M6.9 12.3a1.2 1.2 0 0 0 2.2 0"/><path d="M4.5 4.5l7 7"/>',
  vol:      '<path d="M3 6.4v3.2h2.1L9 12.6V3.4L5.1 6.4H3Z"/><path d="M11 6a3 3 0 0 1 0 4"/>',
  "vol-mute":'<path d="M3 6.4v3.2h2.1L9 12.6V3.4L5.1 6.4H3Z"/><path d="M10.8 6.4l3 3.2M13.8 6.4l-3 3.2"/>',
  mic:      '<rect x="6" y="2.4" width="4" height="7" rx="2"/><path d="M4.4 8.4a3.6 3.6 0 0 0 7.2 0M8 12v2"/>',
  "mic-mute":'<rect x="6" y="2.4" width="4" height="7" rx="2"/><path d="M4.4 8.4a3.6 3.6 0 0 0 7.2 0M8 12v2"/><path d="M4.5 4.5l7 7"/>',
  wifi:     '<path d="M2.6 6.4a8 8 0 0 1 10.8 0M4.6 8.9a5 5 0 0 1 6.8 0"/><circle cx="8" cy="11.4" r="1.05" fill="currentColor" stroke="none"/>',
  "wifi-off":'<path d="M2.6 6.4a8 8 0 0 1 10.8 0"/><circle cx="8" cy="11.4" r="1.05" fill="currentColor" stroke="none"/><path d="M4.5 4.5l7 7"/>',
  ethernet: '<rect x="5.4" y="9.4" width="5.2" height="4.2" rx="0.6"/><path d="M8 9.4V6M4.4 8V6H11.6V8"/>',
  bt:       '<g transform="translate(3, 3) scale(0.6)"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.5351 10.7951L17.1065 6.54508C17.6312 6.14486 17.6312 5.35514 17.1065 4.95492L11.5351 0.704921C10.8769 0.202853 9.92857 0.672195 9.92857 1.5L9.92857 10C9.92857 10.8278 10.8769 11.2971 11.5351 10.7951ZM11.9286 3.52056L14.8512 5.75L11.9286 7.97945L11.9286 3.52056Z" fill="currentColor" stroke="none"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.5351 19.2951L17.1065 15.0451C17.6312 14.6449 17.6312 13.8551 17.1065 13.4549L11.5351 9.20492C10.8769 8.70285 9.92857 9.1722 9.92857 10L9.92857 18.5C9.92857 19.3278 10.8769 19.7971 11.5351 19.2951ZM11.9286 12.0206L14.8512 14.25L11.9286 16.4794L11.9286 12.0206Z" fill="currentColor" stroke="none"/><path d="M11.5264 9.19846C11.9692 9.52866 12.0604 10.1552 11.7302 10.5979C11.4 11.0406 10.7734 11.1318 10.3307 10.8016L3.36641 5.60719C2.9237 5.27699 2.8325 4.65043 3.1627 4.20772C3.4929 3.76502 4.11946 3.67382 4.56216 4.00402L11.5264 9.19846Z" fill="currentColor" stroke="none"/><path d="M11.5264 10.8015C11.9692 10.4713 12.0604 9.84478 11.7302 9.40207C11.4 8.95937 10.7734 8.86817 10.3307 9.19837L3.36641 14.3928C2.9237 14.723 2.8325 15.3496 3.1627 15.7923C3.4929 16.235 4.11946 16.3262 4.56216 15.996L11.5264 10.8015Z" fill="currentColor" stroke="none"/></g>',
  "bt-off": '<g transform="translate(4, 4) scale(0.6)"><path d="m 7.957031 0 c -0.128906 0.0078125 -0.253906 0.0390625 -0.371093 0.0898438 c -0.355469 0.1640622 -0.585938 0.5195312 -0.585938 0.9101562 v 4.9375 l -5.46875 -5.46875 l -1.0625 1.0625 l 14 14 l 1.0625 -1.0625 l -2.605469 -2.605469 c 0.15625 -0.390625 0.046875 -0.835937 -0.269531 -1.113281 l -3.136719 -2.75 l 3.136719 -2.75 c 0.21875 -0.1875 0.34375 -0.460938 0.34375 -0.75 s -0.125 -0.5625 -0.34375 -0.75 l -4 -3.5 c -0.191406 -0.171875 -0.445312 -0.2578125 -0.699219 -0.25 z m 1.042969 3.203125 l 1.480469 1.296875 l -1.480469 1.296875 z m -3.609375 5.25 l -2.046875 1.796875 c -0.417969 0.363281 -0.457031 0.992188 -0.09375 1.40625 c 0.363281 0.417969 0.992188 0.457031 1.40625 0.09375 l 2.152344 -1.878906 z m 1.609375 1.609375 v 4.9375 c 0 0.390625 0.230469 0.746094 0.585938 0.910156 c 0.359374 0.160156 0.777343 0.101563 1.070312 -0.160156 l 2.152344 -1.878906 l -1.414063 -1.414063 l -0.394531 0.339844 v -0.734375 z m 0 0" fill="currentColor" stroke="none"/></g>',
  play:     '<path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" stroke="none"/>',
  pause:    '<path d="M5.5 3.5h2v9h-2zM8.5 3.5h2v9h-2z" fill="currentColor" stroke="none"/>',
  prev:     '<path d="M11 4v8L6 8l5-4Z" fill="currentColor" stroke="none"/><rect x="4" y="4" width="1.5" height="8" rx="0.4" fill="currentColor" stroke="none"/>',
  next:     '<path d="M5 4v8l5-4-5-4Z" fill="currentColor" stroke="none"/><rect x="10.5" y="4" width="1.5" height="8" rx="0.4" fill="currentColor" stroke="none"/>',

  lock:      '<rect x="4" y="7" width="8" height="6" rx="1.4"/><path d="M5.6 7V5.6a2.4 2.4 0 0 1 4.8 0V7"/>',
  refresh:   '<path d="M12.5 6.5A5 5 0 1 0 13 9"/><path d="M12.8 3.2v3.3H9.5"/>',
  power:     '<path d="M8 2.6v5"/><path d="M4.9 4.9a5 5 0 1 0 6.2 0"/>',
  close:     '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  check:     '<path d="M3.5 8.5 6.5 11.5 12.5 5"/>',
  scan:      '<path d="M2.6 5.5v-1a1.4 1.4 0 0 1 1.4-1.4h1.5M10.5 3.1H12a1.4 1.4 0 0 1 1.4 1.4v1M13.4 10.5v1a1.4 1.4 0 0 1-1.4 1.4h-1.5M5.5 12.9H4a1.4 1.4 0 0 1-1.4-1.4v-1"/>',
  trash:     '<path d="M3.5 4.5h9M6 4.5V3.4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.1M5 4.5l.6 8a1 1 0 0 0 1 .9h2.8a1 1 0 0 0 1-.9l.6-8"/>',
  "wifi-mid":'<path d="M4.6 8.9a5 5 0 0 1 6.8 0"/><circle cx="8" cy="11.4" r="1.05" fill="currentColor" stroke="none"/>',
  "wifi-low":'<path d="M6 10.2a3 3 0 0 1 4 0"/><circle cx="8" cy="11.6" r="1" fill="currentColor" stroke="none"/>',
  headset:   '<path d="M3.5 9.5V8a4.5 4.5 0 0 1 9 0v1.5"/><rect x="2.6" y="9.2" width="2.6" height="4" rx="1"/><rect x="10.8" y="9.2" width="2.6" height="4" rx="1"/>',
  mouse:     '<rect x="5" y="2.6" width="6" height="10.8" rx="3"/><path d="M8 4.6v2.4"/>',
  keyboard:  '<rect x="2" y="4.5" width="12" height="7" rx="1.4"/><path d="M4 6.8h.02M6 6.8h.02M8 6.8h.02M10 6.8h.02M12 6.8h.02M5 9.2h6"/>',
  super:     '<path d="M8 2.4 13.6 8 8 13.6 2.4 8Z"/><path d="M8 5.6 10.4 8 8 10.4 5.6 8Z"/>',
  ctrl:      '<path d="M3.6 9.8 8 4.6l4.4 5.2"/>',
  alt:       '<path d="M2.6 5.4h10.8M2.6 10.6h4L10.8 5.4"/>',
  shift:     '<path d="M8 2.8 13 8.4H10.2v5.2H5.8V8.4H3L8 2.8Z"/>',
  phone:     '<rect x="5" y="2.5" width="6" height="11" rx="1.6"/><path d="M7 11.5h2"/>',
  watch:     '<rect x="5" y="5" width="6" height="6" rx="1.6"/><path d="M6.5 5l.3-2.4h2.4l.3 2.4M6.5 11l.3 2.4h2.4l.3-2.4"/>',
  controller:'<path d="M5.5 6h5a3 3 0 0 1 2.9 3.7l-.2.7a1.7 1.7 0 0 1-3 .5L9.2 9.8H6.8L5.8 10.9a1.7 1.7 0 0 1-3-.5l-.2-.7A3 3 0 0 1 5.5 6Z"/><path d="M5 7.8v1.6M4.2 8.6h1.6"/>',
  printer:   '<path d="M4.5 6.5V3h7v3.5"/><rect x="2.5" y="6.5" width="11" height="4.5" rx="1"/><rect x="4.5" y="9.5" width="7" height="4" rx="0.6"/>',
  computer:  '<rect x="2.5" y="3.5" width="11" height="7.5" rx="1.2"/><path d="M6 13.4h4M8 11v2.4"/>',
  device:    '<circle cx="8" cy="8" r="5.4"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/>',
  sleep:     '<path d="M9.7 3.2a5.5 5.5 0 1 1-5 8c2.5-.3 4.6-2.7 4.6-5.7 0-1-.3-2-.7-2.8"/><circle cx="8" cy="8" r="5.4" stroke="none" fill="none"/>',
  logout:    '<rect x="2.6" y="2.6" width="7.4" height="10.8" rx="1.4"/><path d="M6 8h7M10 5.5 13 8l-3 2.5"/>',
  dashboard: '<rect x="2.4" y="2.4" width="5.2" height="5.2" rx="1"/><rect x="8.4" y="2.4" width="5.2" height="5.2" rx="1"/><rect x="2.4" y="8.4" width="5.2" height="5.2" rx="1"/><rect x="8.4" y="8.4" width="5.2" height="5.2" rx="1"/>',
  cog:       '<g transform="translate(0.8, 0.8) scale(0.60)"><path d="M14.0352,2.80881 C14.4041,2.54328 14.9244,2.41911 15.4361,2.60633 C16.5334,3.00779 17.5399,3.59556 18.4176,4.33073 C18.8347,4.6801 18.9873,5.19202 18.942,5.64392 C18.8666,6.39677 18.9994,7.12366 19.3611,7.7502 C19.6827889,8.30737333 20.1637667,8.74748988 20.7513584,9.05690332 L20.9766,9.16678 C21.3914,9.35374 21.7593,9.74288 21.8525,10.2803 C21.9495,10.8397 22,11.4144 22,12.0001 C22,12.5858 21.9495,13.1606 21.8525,13.72 C21.76862,14.20366 21.462233,14.567197 21.0994052,14.7713908 L20.9766,14.8335 C20.2865,15.1446 19.723,15.6233 19.3611,16.2501 C18.9994,16.8766 18.8666,17.6034 18.942,18.3562 C18.9872,18.8081 18.8347,19.32 18.4176,19.6694 C17.5399,20.4045 16.5334,20.9923 15.4362,21.3937 C14.9245,21.581 14.4042,21.4568 14.0353,21.1912 C13.4206,20.7488 12.7241,20.5 12,20.5 C11.2759,20.5 10.5794,20.7488 9.96474,21.1912 C9.59585,21.4568 9.07552,21.581 8.56378,21.3937 C7.46655,20.9923 6.46002,20.4045 5.5823,19.6693 C5.16523,19.32 5.01269,18.8081 5.05794,18.3562 C5.13332,17.6034 5.00045,16.8766 4.63874,16.2501 C4.31706,15.6929444 3.83615432,15.2528062 3.24858549,14.9433807 L3.02335,14.8335 C2.6086,14.6465 2.24075,14.2574 2.14752,13.72 C2.05047,13.1606 2,12.5858 2,12.0001 C2,11.4143 2.05047,10.8396 2.14751,10.2801 C2.231417,9.796467 2.5377662,9.4329165 2.90054972,9.2287416 L3.02334,9.16664 C3.71344,8.85555 4.27685,8.37689 4.63874,7.75007 C5.00046,7.12356 5.13333,6.39671 5.05794,5.64391 C5.01268,5.19203 5.16522,4.68015 5.5823,4.3308 C6.46004,3.59559 7.4666,3.0078 8.56387,2.60633 C9.07558,2.4191 9.59589,2.54328 9.96478,2.80881 C10.5794,3.25123 11.2759,3.50003 12,3.50003 C12.7241,3.50003 13.4206,3.25123 14.0352,2.80881 Z M14.9917,4.57792 C14.1261,5.14715 13.1053,5.50003 12,5.50003 C10.8947,5.50003 9.87388,5.14715 9.00832,4.57792 C8.30727,4.8608 7.65502,5.24042 7.0682,5.70056 C7.12793,6.734 6.92299,7.79365 6.37079,8.75007 C5.81845,9.70677 5.00295,10.4142 4.07778,10.8792 C4.02655,11.245 4,11.6192 4,12.0001 C4,12.381 4.02655,12.7551 4.07778,13.121 C5.00295,13.586 5.81845,14.2934 6.37079,15.2501 C6.92298,16.2065 7.12793,17.2661 7.0682,18.2995 C7.655,18.7597 8.30722,19.1393 9.00824,19.4222 C9.87381,18.8529 10.8947,18.5 12,18.5 C13.1053,18.5 14.1262,18.8529 14.9918,19.4222 C15.6927,19.1393 16.3449,18.7597 16.9317,18.2996 C16.872,17.2662 17.0769,16.2065 17.6291,15.2501 C18.1815,14.2933 18.997,13.5859 19.9222,13.1209 C19.9735,12.7551 20,12.381 20,12.0001 C20,11.6192 19.9735,11.2451 19.9222,10.8794 C18.997,10.4144 18.1815,9.70693 17.6291,8.7502 C17.0769,7.79371 16.8719,6.734 16.9317,5.7005 C16.3449,5.24039 15.6927,4.86079 14.9917,4.57792 Z M12,8 C14.2091,8 16,9.79086 16,12 C16,14.2091 14.2091,16 12,16 C9.79086,16 8,14.2091 8,12 C8,9.79086 9.79086,8 12,8 Z M12,10 C10.8954,10 10,10.8954 10,12 C10,13.1046 10.8954,14 12,14 C13.1046,14 14,13.1046 14,12 C14,10.8954 13.1046,10 12,10 Z" fill="currentColor" stroke="none"/></g>',

  "w-sunny":  '<circle cx="8" cy="8" r="3"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/>',
}

const cache = new Map<string, GdkPixbuf.Pixbuf | null>()

const FILE_ICONS: Record<string, string> = {
  wifi:      'wifi.svg',
  'wifi-mid': 'wifi-2.svg',
  'wifi-low': 'wifi-1.svg',
  'wifi-off': 'wifi-off.svg',
}

function fileIconPixbuf(name: string, px: number): GdkPixbuf.Pixbuf | null {
  const file = FILE_ICONS[name]
  if (!file) return null
  const path = GLib.build_filenamev([AGS_CONFIG_DIR, 'assets', file])
  try {
    return GdkPixbuf.Pixbuf.new_from_file_at_scale(path, px, px, true)
  } catch (_) { return null }
}

function svgToPixbuf(svg: string, px: number): GdkPixbuf.Pixbuf | null {
  try {
    const bytes  = new TextEncoder().encode(svg)
    const stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(bytes))
    return GdkPixbuf.Pixbuf.new_from_stream_at_scale(stream, px, px, true, null)
  } catch (_) { return null }
}

function build(name: string, color: string, px: number): GdkPixbuf.Pixbuf | null {
  const filePb = fileIconPixbuf(name, px)
  if (filePb) return filePb

  const inner = P[name]
  if (!inner) return null
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16"` +
    ` fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">` +
    `${inner.split("currentColor").join(color)}</svg>`
  return svgToPixbuf(svg, px)
}

export function setBarIcon(img: Gtk.Image, name: string, color: string, px = 16): void {
  const key = `${name}|${color}|${px}`
  if (!cache.has(key)) cache.set(key, build(name, color, px))
  const pb = cache.get(key)
  if (pb) img.set_from_pixbuf(pb)
}

export function iconImage(name: string, color: string, px = 16): Gtk.Image {
  const img = new Gtk.Image({ visible: true })
  setBarIcon(img, name, color, px)
  return img
}

type Acc<T> = { (): T; subscribe: (cb: () => void) => (() => void) }
function isAcc(x: any): x is Acc<any> { return x && typeof x === "function" && typeof x.subscribe === "function" }

export function IconImg(name: string | Acc<string>, color: string | Acc<string>, px = 16): Gtk.Image {
  const img = new Gtk.Image({ visible: true })
  const render = () => setBarIcon(img, isAcc(name) ? name() : name, isAcc(color) ? color() : color, px)
  render()
  const subs: Array<() => void> = []
  if (isAcc(name))  subs.push(name.subscribe(render))
  if (isAcc(color)) subs.push(color.subscribe(render))
  if (subs.length) img.connect("destroy", () => subs.forEach(u => { try { u() } catch (_) {} }))
  return img
}

export function setBatteryIcon(img: Gtk.Image, pct: number, charging: boolean, color: string, px = 16): void {
  const p = Math.max(0, Math.min(100, pct))
  const key = `batt|${Math.round(p / 5) * 5}|${charging ? 1 : 0}|${color}|${px}`
  if (!cache.has(key)) {
    const fillW = (p / 100) * 8
    const fill  = fillW > 0.4 ? `<rect x="3.2" y="6.2" width="${fillW.toFixed(2)}" height="3.6" rx="0.4" fill="${color}" stroke="none"/>` : ""
    const bolt  = charging ? `<path d="M8.4 5.6l-1.9 2.7h1.6l-1.5 2.5" fill="none" stroke="${color}" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"/>` : ""
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16">` +
      `<rect x="2" y="5" width="10.6" height="6" rx="1.3" stroke="${color}" fill="none" stroke-width="1.4"/>` +
      `<path d="M14 7.1v1.8" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>${fill}${bolt}</svg>`
    cache.set(key, svgToPixbuf(svg, px))
  }
  const pb = cache.get(key)
  if (pb) img.set_from_pixbuf(pb)
}
