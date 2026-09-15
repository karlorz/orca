import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command MUTE. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandMute(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandMute(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandMute(state) === false
}
