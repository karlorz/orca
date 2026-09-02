import { Platform } from 'react-native'
import { getExpoPetSpeechModule } from './pet-speak-native-adapter'
import { applyPetSpeakCaptionRange } from './pet-speak-caption-range'

let attached = false

export function attachNativeCaptionRangeListener(): void {
  if (attached || Platform.OS !== 'android') {
    return
  }
  const nativeModule = getExpoPetSpeechModule()
  if (!nativeModule?.addListener) {
    console.log(`[PetSpeakCaption] attach skipped: module=${nativeModule ? 'present' : 'null'} addListener=${typeof nativeModule?.addListener}`)
    return
  }
  try {
    nativeModule.addListener('onCaptionRange', (event) => {
      if (
        event &&
        typeof event.start === 'number' &&
        typeof event.end === 'number' &&
        typeof event.eventId === 'string'
      ) {
        applyPetSpeakCaptionRange({
          eventId: event.eventId,
          start: event.start,
          end: event.end
        })
      } else {
        console.log('[PetSpeakCaption] onCaptionRange dropped by shape filter')
      }
    })
    attached = true
  } catch (error) {
    // Debug shells without the rebuilt native module keep full-line captions.
    console.log(`[PetSpeakCaption] attach failed: ${String(error)}`)
  }
}
