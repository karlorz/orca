import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command SKIP. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandSkip(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandSkip(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandSkip(state) === false
}
