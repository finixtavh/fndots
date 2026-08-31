// Audio Selection
import GLib from "gi://GLib"
import Gio from "gi://Gio"
import AstalWp from "gi://AstalWp"
import { dwarn } from "./DashLog"

export type AudioSelectionKind = "output" | "input"
export type AudioNode = AstalWp.Node

export interface AudioSelectionGroup {
  key: string
  label: string
  icon: string
  role: "application" | "output" | "input"
  nodes: AudioNode[]
}

export interface AudioSelectionSection {
  title: string
  emptyLabel: string
  groups: AudioSelectionGroup[]
}

interface SelectionState {
  version: 1
  output: string
  input: string
}

const stateHome = GLib.getenv("XDG_STATE_HOME")
const stateDirectory = stateHome && GLib.path_is_absolute(stateHome)
  ? GLib.build_filenamev([stateHome, "ags"])
  : GLib.build_filenamev([GLib.get_home_dir(), ".local", "state", "ags"])
const stateFile = GLib.build_filenamev([stateDirectory, "audio-mainbar-selection.json"])
const decoder = new TextDecoder()
const encoder = new TextEncoder()
const listeners = new Set<(kind: AudioSelectionKind) => void>()
const selection: SelectionState = { version: 1, output: "", input: "" }

function pipewireProperty(node: any, key: string): string {
  try {
    const value = node?.get_pw_property?.(key)
    return value == null ? "" : String(value).trim()
  } catch (_) {
    return ""
  }
}

function nodeText(node: any, property: string, getter: string): string {
  try {
    const value = node?.[property] ?? node?.[getter]?.()
    return value == null ? "" : String(value).trim()
  } catch (_) {
    return ""
  }
}

function applicationInfo(node: AudioNode): Omit<AudioSelectionGroup, "nodes"> {
  const appId = pipewireProperty(node, "application.id")
  const binary = pipewireProperty(node, "application.process.binary")
  const appName = pipewireProperty(node, "application.name")
  const nodeName = pipewireProperty(node, "node.name") || nodeText(node, "name", "get_name")
  const description = nodeText(node, "description", "get_description")

  return {
    key: appId || binary || appName || nodeName || `stream-${node.id}`,
    label: appName || description || binary || nodeName || "Audio application",
    icon: pipewireProperty(node, "application.icon-name") || appId || binary || node.icon || "",
    role: "application",
  }
}

function playbackGroups(wp: AstalWp.Wp): AudioSelectionGroup[] {
  const groups = new Map<string, AudioSelectionGroup>()
  for (const stream of wp.get_nodes() ?? []) {
    if (stream.media_class !== AstalWp.MediaClass.STREAM_OUTPUT_AUDIO) continue
    const info = applicationInfo(stream)
    const existing = groups.get(info.key)
    if (existing) {
      existing.nodes.push(stream)
      if (!existing.icon && info.icon) existing.icon = info.icon
    } else {
      groups.set(info.key, { ...info, nodes: [stream] })
    }
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label))
}

function outputDeviceGroups(wp: AstalWp.Wp): AudioSelectionGroup[] {
  return (wp.get_nodes() ?? [])
    .filter(node => node.media_class === AstalWp.MediaClass.AUDIO_SINK)
    .map(node => {
      const name = nodeText(node, "name", "get_name")
      return {
        key: `output-${name || node.serial || node.id}`,
        label: nodeText(node, "description", "get_description") || name || "Output device",
        icon: "",
        role: "output" as const,
        nodes: [node],
      }
    })
    .sort((left, right) => left.label.localeCompare(right.label))
}

function inputGroups(wp: AstalWp.Wp): {
  physical: AudioSelectionGroup[]
  virtual: AudioSelectionGroup[]
} {
  const nodes = wp.get_nodes() ?? []
  const physicalSources = nodes.filter(node =>
    node.media_class === AstalWp.MediaClass.AUDIO_SOURCE)
  const virtualSources = nodes.filter(node =>
    node.media_class === AstalWp.MediaClass.AUDIO_SOURCE_VIRTUAL)
  const sourceNames = new Set([...physicalSources, ...virtualSources]
    .map(source => nodeText(source, "name", "get_name")))

  const physical = physicalSources.map(source => {
    const name = nodeText(source, "name", "get_name")
    return {
      key: `input-${name || source.serial || source.id}`,
      label: nodeText(source, "description", "get_description") || name || "Input device",
      icon: "",
      role: "input" as const,
      nodes: [source],
    }
  })

  const virtual = virtualSources.map(source => {
    const name = nodeText(source, "name", "get_name")
    return {
      key: `virtual-${name || source.serial || source.id}`,
      label: nodeText(source, "description", "get_description") || name || "Virtual input",
      icon: "",
      role: "input" as const,
      nodes: [source],
    }
  })

  const monitors: AudioSelectionGroup[] = nodes
    .filter(node => node.media_class === AstalWp.MediaClass.AUDIO_SINK)
    .filter(sink => !sourceNames.has(`${nodeText(sink, "name", "get_name")}.monitor`))
    .map(sink => {
      const name = nodeText(sink, "name", "get_name")
      const description = nodeText(sink, "description", "get_description") || name || "Output"
      return {
        key: `monitor-${name || sink.serial || sink.id}`,
        label: `${description} Monitor`,
        icon: "",
        role: "input",
        nodes: [sink],
      }
    })

  return {
    physical: physical.sort((left, right) => left.label.localeCompare(right.label)),
    virtual: [...virtual, ...monitors]
      .sort((left, right) => left.label.localeCompare(right.label)),
  }
}

function loadSelection(): void {
  try {
    const [ok, raw] = GLib.file_get_contents(stateFile)
    if (!ok) return
    const parsed = JSON.parse(decoder.decode(raw))
    if (!parsed || parsed.version !== 1) return
    if (typeof parsed.output === "string") selection.output = parsed.output.slice(0, 512)
    if (typeof parsed.input === "string") selection.input = parsed.input.slice(0, 512)
  } catch (error) {
    dwarn("[AudioSelection] Could not load selection:", error)
  }
}

function saveSelection(): void {
  try {
    GLib.mkdir_with_parents(stateDirectory, 0o700)
    Gio.File.new_for_path(stateFile).replace_contents(
      encoder.encode(JSON.stringify(selection, null, 2)),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE,
      null,
    )
    GLib.chmod(stateFile, 0o600)
  } catch (error) {
    dwarn("[AudioSelection] Could not save selection:", error)
  }
}

export function audioSelectionGroups(
  wp: AstalWp.Wp,
  kind: AudioSelectionKind,
): AudioSelectionGroup[] {
  return audioSelectionSections(wp, kind).flatMap(section => section.groups)
}

export function audioSelectionSections(
  wp: AstalWp.Wp,
  kind: AudioSelectionKind,
): AudioSelectionSection[] {
  if (kind === "output") {
    return [
      {
        title: "Applications",
        emptyLabel: "No applications are playing audio",
        groups: playbackGroups(wp),
      },
      {
        title: "Output Devices",
        emptyLabel: "No output devices found",
        groups: outputDeviceGroups(wp),
      },
    ]
  }

  const inputs = inputGroups(wp)
  return [
    {
      title: "Physical Inputs",
      emptyLabel: "No physical inputs found",
      groups: inputs.physical,
    },
    {
      title: "Virtual Inputs",
      emptyLabel: "No virtual inputs found",
      groups: inputs.virtual,
    },
  ]
}

export function selectedAudioGroup(
  wp: AstalWp.Wp,
  kind: AudioSelectionKind,
): AudioSelectionGroup | null {
  const groups = audioSelectionGroups(wp, kind)
  if (groups.length === 0) return null

  const preferred = groups.find(group => group.key === selection[kind])
  if (preferred) return preferred

  const defaultNode = kind === "output"
    ? wp.get_default_speaker?.()
    : wp.get_default_microphone?.()
  const defaultId = Number(defaultNode?.id)
  const defaultGroup = groups.find(group => group.nodes.some(node =>
    node === (defaultNode as any)
    || (Number.isFinite(defaultId) && Number(node.id) === defaultId)))
  if (defaultGroup) return defaultGroup
  return groups[0]
}

export function selectAudioGroup(kind: AudioSelectionKind, key: string): void {
  const normalized = key.trim().slice(0, 512)
  if (!normalized || selection[kind] === normalized) return
  selection[kind] = normalized
  saveSelection()
  for (const listener of listeners) {
    try { listener(kind) } catch (_) {}
  }
}

export function subscribeAudioSelection(
  listener: (kind: AudioSelectionKind) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function audioGroupVolume(nodes: AudioNode[]): number {
  if (nodes.length === 0) return 0
  return nodes.reduce((total, node) => total + Number(node.volume || 0), 0) / nodes.length
}

export function audioGroupMuted(nodes: AudioNode[]): boolean {
  return nodes.length > 0 && nodes.every(node => Boolean(node.mute))
}

loadSelection()
