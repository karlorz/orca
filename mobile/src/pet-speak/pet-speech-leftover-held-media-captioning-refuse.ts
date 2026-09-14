import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command CAPTIONING. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandCaptioning(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandCaptioning(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandCaptioning(state) === false
}
