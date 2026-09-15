import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command FAST-FORWARD. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandFastForward(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandFastForward(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandFastForward(state) === false
}
