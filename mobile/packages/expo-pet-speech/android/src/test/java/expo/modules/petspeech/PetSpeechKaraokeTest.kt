package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Test

class PetSpeechKaraokeTest {
    @Test
    fun startMsConvertsFramesAtSampleRate() {
        assertEquals(0, PetSpeechKaraoke.startMs(0, 24000))
        assertEquals(500, PetSpeechKaraoke.startMs(12000, 24000))
        assertEquals(0, PetSpeechKaraoke.startMs(100, 0))
    }

    @Test
    fun wallDelayScalesByPlaybackRate() {
        assertEquals(1000L, PetSpeechKaraoke.wallDelayMs(1000, 1f))
        assertEquals(500L, PetSpeechKaraoke.wallDelayMs(1000, 2f))
        assertEquals(1000L, PetSpeechKaraoke.wallDelayMs(1000, 0f))
    }
}
