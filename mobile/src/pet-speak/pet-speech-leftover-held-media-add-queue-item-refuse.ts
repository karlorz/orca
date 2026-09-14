import { isLeftoverHeld, type LeftoverHeldState } from './pet-speech-leftover-held-tts-refuse'

export type { LeftoverHeldState }

/** Leftover-held never honors media-command ADD-QUEUE-ITEM. Fail-closed; not a matrix. */
export function leftoverHeldHonorMediaCommandAddQueueItem(_state: LeftoverHeldState): boolean {
  return false
}

export function leftoverHeldRefusesMediaCommandAddQueueItem(state: LeftoverHeldState): boolean {
  if (!isLeftoverHeld(state)) {
    return false
  }
  return leftoverHeldHonorMediaCommandAddQueueItem(state) === false
}
