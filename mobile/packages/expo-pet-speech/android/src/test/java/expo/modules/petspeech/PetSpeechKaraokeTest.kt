package expo.modules.petspeech

import android.speech.tts.TextToSpeech
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
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

    @Test
    fun acceptsCallbackIdHandlesNullAndMatchingIds() {
        assertTrue(PetSpeechKaraoke.acceptsCallbackId(null, "utterance_1"))
        assertTrue(PetSpeechKaraoke.acceptsCallbackId("utterance_1", "utterance_1"))
        assertFalse(PetSpeechKaraoke.acceptsCallbackId("other", "utterance_1"))
    }

    @Test
    fun utteranceParamsIncludesUtteranceId() {
        var recordedKey: String? = null
        var recordedValue: String? = null
        val bundle = PetSpeechKaraoke.utteranceParams("u1") { key, value ->
            recordedKey = key
            recordedValue = value
        }
        assertNotNull(bundle)
        assertEquals(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, recordedKey)
        assertEquals("u1", recordedValue)
    }
}
