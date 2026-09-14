export function shouldRetainHostConnection(input: {
  persistHeld: boolean
  keepHostConnection: boolean
  petSpeechEnabled: boolean
}): boolean {
  // persistHeld is persist switch ON and the FGS actually held.
  return input.petSpeechEnabled && input.persistHeld && input.keepHostConnection
}

let retainRuntime = false
const listeners = new Set<(retain: boolean) => void>()

export function getHostConnectionRetainRuntime(): boolean {
  return retainRuntime
}

export function setHostConnectionRetainRuntime(retain: boolean): void {
  if (retainRuntime === retain) {
    return
  }
  retainRuntime = retain
  for (const listener of listeners) {
    listener(retainRuntime)
  }
}

export function subscribeHostConnectionRetainRuntime(
  listener: (retain: boolean) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetHostConnectionRetainRuntimeForTests(): void {
  retainRuntime = false
  listeners.clear()
}
