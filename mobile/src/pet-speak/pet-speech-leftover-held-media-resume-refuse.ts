import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command RESUME. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandResume(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandResume(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandResume(state) === false
}
