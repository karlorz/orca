export type LeftoverHeldState = {
  isSessionHeld: boolean
  isAcquiring: boolean
  connectedCount: number
}

export function isLeftoverHeld(state: LeftoverHeldState): boolean {
  return state.isSessionHeld && state.connectedCount === 0
}

/** Leftover-held never starts TTS. Fail-closed; not a media-command matrix. */
export function leftoverHeldStartTts(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesTtsStart(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldStartTts(state) === false
}
