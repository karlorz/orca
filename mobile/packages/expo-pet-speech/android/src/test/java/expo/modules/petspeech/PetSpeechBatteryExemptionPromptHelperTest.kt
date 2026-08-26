package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechBatteryExemptionPromptHelperTest {

    @Test
    fun doesNotPromptIfAlreadyPrompted() {
        var prompted = true
        var startedIntent = false

        val result = PetSpeechBatteryExemptionPromptHelper.requestExemptionIfNeeded(
            isPrompted = { prompted },
            isIgnoringBatteryOptimizations = { false },
            markPrompted = { prompted = true },
            startExemptionActivity = { startedIntent = true }
        )

        assertFalse(result)
        assertFalse(startedIntent)
        assertTrue(prompted)
    }

    @Test
    fun marksPromptedWithoutIntentIfAlreadyIgnoringOptimizations() {
        var prompted = false
        var startedIntent = false

        val result = PetSpeechBatteryExemptionPromptHelper.requestExemptionIfNeeded(
            isPrompted = { prompted },
            isIgnoringBatteryOptimizations = { true },
            markPrompted = { prompted = true },
            startExemptionActivity = { startedIntent = true }
        )

        assertFalse(result)
        assertFalse(startedIntent)
        assertTrue(prompted)
    }

    @Test
    fun promptsAndMarksPromptedWhenNeverPromptedAndNotIgnoring() {
        var prompted = false
        var startedIntent = false

        val result = PetSpeechBatteryExemptionPromptHelper.requestExemptionIfNeeded(
            isPrompted = { prompted },
            isIgnoringBatteryOptimizations = { false },
            markPrompted = { prompted = true },
            startExemptionActivity = { startedIntent = true }
        )

        assertTrue(result)
        assertTrue(startedIntent)
        assertTrue(prompted)
    }
}
