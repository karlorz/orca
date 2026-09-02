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

    @Test
    fun interpretRangesSwappedGoogleTtsTriples() {
        val raw = listOf(
            intArrayOf(360, 0, 2),
            intArrayOf(18960, 3, 4),
            intArrayOf(23639, 4, 5),
            intArrayOf(28560, 5, 6),
            intArrayOf(33959, 6, 7),
            intArrayOf(37799, 7, 9),
            intArrayOf(48360, 9, 11),
            intArrayOf(67680, 12, 14),
            intArrayOf(76199, 14, 16),
            intArrayOf(85079, 16, 18),
            intArrayOf(106200, 19, 21),
            intArrayOf(114479, 21, 23),
            intArrayOf(122999, 23, 25),
            intArrayOf(132959, 26, 29),
            intArrayOf(156479, 30, 31),
            intArrayOf(161639, 31, 32),
            intArrayOf(166439, 32, 33)
        )
        val ranges = PetSpeechKaraoke.interpretRanges(raw, 34, 24000)
        assertEquals(17, ranges.size)
        assertEquals(PetSpeechCaptionRange(start = 0, end = 2, startMs = 15), ranges[0])
        assertEquals(PetSpeechCaptionRange(start = 3, end = 4, startMs = 790), ranges[1])
        assertEquals(PetSpeechCaptionRange(start = 32, end = 33, startMs = 6934), ranges[16])
    }

    @Test
    fun interpretRangesDocumentedOrderRegression() {
        val raw = listOf(
            intArrayOf(0, 2, 360),
            intArrayOf(3, 4, 18960),
            intArrayOf(4, 5, 23639)
        )
        val ranges = PetSpeechKaraoke.interpretRanges(raw, 34, 24000)
        assertEquals(3, ranges.size)
        assertEquals(PetSpeechCaptionRange(start = 0, end = 2, startMs = 15), ranges[0])
        assertEquals(PetSpeechCaptionRange(start = 3, end = 4, startMs = 790), ranges[1])
        assertEquals(PetSpeechCaptionRange(start = 4, end = 5, startMs = 984), ranges[2])
    }

    @Test
    fun interpretRangesGarbageDropsInvalid() {
        val raw = listOf(
            intArrayOf(5, 2, 1)
        )
        val ranges = PetSpeechKaraoke.interpretRanges(raw, 3, 24000)
        assertTrue(ranges.isEmpty())
    }
}
