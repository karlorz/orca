import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command PREPARE-FROM-SEARCH. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandPrepareFromSearch(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandPrepareFromSearch(
  state: LeftoverHeldState
): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandPrepareFromSearch(state) === false
}
