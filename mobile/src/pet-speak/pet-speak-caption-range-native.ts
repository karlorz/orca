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
      }
    })
    attached = true
  } catch {
    // Debug shells without the rebuilt native module keep full-line captions.
  }
}
