import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command CLEAR-QUEUE. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandClearQueue(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandClearQueue(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandClearQueue(state) === false
}
