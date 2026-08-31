// Osd Events
export type OsdEvent = 'caps' | 'output-mute' | 'input-mute'

const listeners = new Set<(event: OsdEvent) => void>()

export function emitOsdEvent(event: OsdEvent): void {
  for (const listener of [...listeners]) listener(event)
}

export function subscribeOsdEvents(listener: (event: OsdEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
