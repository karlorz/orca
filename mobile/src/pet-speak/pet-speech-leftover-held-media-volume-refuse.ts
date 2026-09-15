import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command VOLUME. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandVolume(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandVolume(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandVolume(state) === false
}
