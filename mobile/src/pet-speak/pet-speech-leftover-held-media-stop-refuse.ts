import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command STOP. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandStop(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandStop(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandStop(state) === false
}
