package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Test

class PetSpeechRateTest {
    @Test
    fun missingOrInvalidUsesDefault() {
        assertEquals(1.2f, PetSpeechRate.parse(null))
        assertEquals(1.2f, PetSpeechRate.parse("nope"))
        assertEquals(1.2f, PetSpeechRate.parse(mapOf("x" to 1)))
        assertEquals(1.2f, PetSpeechRate.parse(Float.NaN))
    }

    @Test
    fun clampsToPetRange() {
        assertEquals(0.5f, PetSpeechRate.parse(0.1), 0.0001f)
        assertEquals(2.5f, PetSpeechRate.parse(9), 0.0001f)
        assertEquals(1.2f, PetSpeechRate.parse(1.2), 0.0001f)
        assertEquals(2.0f, PetSpeechRate.parse(2), 0.0001f)
        assertEquals(0.8f, PetSpeechRate.parse("0.8"), 0.0001f)
    }

    @Test
    fun androidPlaybackIsOneMenuStepFaster() {
        assertEquals(0.8f, PetSpeechRate.androidPlaybackSpeed(0.8f), 0.0001f)
        assertEquals(1.0f, PetSpeechRate.androidPlaybackSpeed(1.0f), 0.0001f)
        assertEquals(1.2f, PetSpeechRate.androidPlaybackSpeed(1.2f), 0.0001f)
        assertEquals(1.5f, PetSpeechRate.androidPlaybackSpeed(1.5f), 0.0001f)
        assertEquals(2.0f, PetSpeechRate.androidPlaybackSpeed(2.0f), 0.0001f)
    }
}
