import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command MEDIA-BUTTON (onMediaButtonEvent). Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandMediaButton(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandMediaButton(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandMediaButton(state) === false
}
