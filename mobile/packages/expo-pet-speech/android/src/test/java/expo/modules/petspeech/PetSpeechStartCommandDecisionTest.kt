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
    fun stopsSelfWhenExtraTextExceeds2000CodePoints() {
        val longText = "長".repeat(2001)
        assertEquals(
            PetSpeechStartCommandDecision.Result.StopSelf,
            PetSpeechStartCommandDecision.decide(longText)
        )
    }

    @Test
    fun startsForegroundFor91AndExactly2000CodePoints() {
        val ask91 = "長".repeat(91)
        val decision91 = PetSpeechStartCommandDecision.decide(ask91)
        assertTrue(decision91 is PetSpeechStartCommandDecision.Result.StartForeground)

        val text2000 = "長".repeat(2000)
        val decision2000 = PetSpeechStartCommandDecision.decide(text2000)
        assertTrue(decision2000 is PetSpeechStartCommandDecision.Result.StartForeground)
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
