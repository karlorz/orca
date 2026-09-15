import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command REPEAT. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandRepeat(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandRepeat(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandRepeat(state) === false
}
