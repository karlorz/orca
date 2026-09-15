import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command REPLACE-QUEUE. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandReplaceQueue(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandReplaceQueue(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandReplaceQueue(state) === false
}
