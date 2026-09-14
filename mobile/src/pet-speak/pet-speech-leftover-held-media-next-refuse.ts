import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command NEXT. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandNext(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandNext(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandNext(state) === false
}
