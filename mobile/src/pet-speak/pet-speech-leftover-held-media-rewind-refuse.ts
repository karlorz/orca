import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command REWIND. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandRewind(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandRewind(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandRewind(state) === false
}
