import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command ADJUST-VOLUME (not VOLUME). Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandAdjustVolume(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandAdjustVolume(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandAdjustVolume(state) === false
}
