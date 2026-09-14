import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command PAUSE. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandPause(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandPause(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandPause(state) === false
}
