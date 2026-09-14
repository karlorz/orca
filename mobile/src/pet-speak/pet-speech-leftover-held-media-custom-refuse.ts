import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command CUSTOM. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandCustom(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandCustom(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandCustom(state) === false
}
