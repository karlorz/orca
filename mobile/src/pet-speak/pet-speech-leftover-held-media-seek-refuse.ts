import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SEEK. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSeek(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSeek(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSeek(state) === false
}
