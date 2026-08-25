package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechStartCommandDecisionTest {

    @Test
    fun stopsSelfWhenIntentIsNull() {
        val decision = PetSpeechStartCommandDecision.decide(null)
        assertEquals(PetSpeechStartCommandDecision.Result.StopSelf, decision)
    }

    @Test
    fun stopsSelfWhenExtraTextIsMissingOrBlank() {
        assertEquals(
            PetSpeechStartCommandDecision.Result.StopSelf,
            PetSpeechStartCommandDecision.decide("")
        )
        assertEquals(
            PetSpeechStartCommandDecision.Result.StopSelf,
            PetSpeechStartCommandDecision.decide("   ")
        )
    }

    @Test
    fun stopsSelfWhenExtraTextExceeds70CodePoints() {
        val longText = "長".repeat(71)
        assertEquals(
            PetSpeechStartCommandDecision.Result.StopSelf,
            PetSpeechStartCommandDecision.decide(longText)
        )
    }

    @Test
    fun startsForegroundWhenValidBoundedTextProvided() {
        val decision = PetSpeechStartCommandDecision.decide("你好呀")
        assertTrue(decision is PetSpeechStartCommandDecision.Result.StartForeground)
        assertEquals("你好呀", (decision as PetSpeechStartCommandDecision.Result.StartForeground).trimmedText)
    }

    @Test
    fun trimsValidTextProperly() {
        val decision = PetSpeechStartCommandDecision.decide("  早晨  ")
        assertTrue(decision is PetSpeechStartCommandDecision.Result.StartForeground)
        assertEquals("早晨", (decision as PetSpeechStartCommandDecision.Result.StartForeground).trimmedText)
    }
}
