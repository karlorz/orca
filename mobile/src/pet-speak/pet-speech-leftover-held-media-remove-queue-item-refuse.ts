import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command REMOVE-QUEUE-ITEM. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandRemoveQueueItem(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandRemoveQueueItem(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandRemoveQueueItem(state) === false
}
