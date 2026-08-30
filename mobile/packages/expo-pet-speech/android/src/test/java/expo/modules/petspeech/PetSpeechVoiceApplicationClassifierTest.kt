package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechVoiceApplicationClassifierTest {

    @Test
    fun noExplicitVoiceAllowsDeviceDefault() {
        val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
            requestedVoiceName = null,
            matchingVoiceFound = false,
            setVoiceResult = null,
            readbackVoiceName = "default-voice",
            readbackNetwork = false,
            exceptionThrown = false
        )
        assertTrue(decision.shouldProceed)
        assertEquals("default-voice", decision.effectiveVoiceName)
        assertFalse(decision.networkRequired)
        assertNull(decision.failureOutcome)
    }

    @Test
    fun blankExplicitVoiceAllowsDeviceDefault() {
        val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
            requestedVoiceName = "   ",
            matchingVoiceFound = false,
            setVoiceResult = null,
            readbackVoiceName = "default-voice",
            readbackNetwork = true,
            exceptionThrown = false
        )
        assertTrue(decision.shouldProceed)
        assertEquals("default-voice", decision.effectiveVoiceName)
        assertTrue(decision.networkRequired)
        assertNull(decision.failureOutcome)
    }

    @Test
    fun missingExplicitVoiceFromEngineFailsVoiceUnavailable() {
        val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
            requestedVoiceName = "yue-hk-x-missing",
            matchingVoiceFound = false,
            setVoiceResult = null,
            readbackVoiceName = "default-voice",
            readbackNetwork = false,
            exceptionThrown = false
        )
        assertFalse(decision.shouldProceed)
        assertEquals(PetSpeechOutcome.VoiceUnavailable, decision.failureOutcome)
    }

    @Test
    fun setVoiceErrorFailsVoiceUnavailable() {
        // TextToSpeech.ERROR is -1
        val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
            requestedVoiceName = "yue-hk-x-yuc-local",
            matchingVoiceFound = true,
            setVoiceResult = -1,
            readbackVoiceName = "yue-hk-x-yuc-local",
            readbackNetwork = false,
            exceptionThrown = false
        )
        assertFalse(decision.shouldProceed)
        assertEquals(PetSpeechOutcome.VoiceUnavailable, decision.failureOutcome)
    }

    @Test
    fun successfulStatusWithReadbackMismatchFailsVoiceUnavailable() {
        // TextToSpeech.SUCCESS is 0
        val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
            requestedVoiceName = "yue-hk-x-yuc-local",
            matchingVoiceFound = true,
            setVoiceResult = 0,
            readbackVoiceName = "yue-hk-x-jar-server",
            readbackNetwork = true,
            exceptionThrown = false
        )
        assertFalse(decision.shouldProceed)
        assertEquals(PetSpeechOutcome.VoiceUnavailable, decision.failureOutcome)
    }

    @Test
    fun successfulStatusWithNullReadbackFailsVoiceUnavailable() {
        val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
            requestedVoiceName = "yue-hk-x-yuc-local",
            matchingVoiceFound = true,
            setVoiceResult = 0,
            readbackVoiceName = null,
            readbackNetwork = false,
            exceptionThrown = false
        )
        assertFalse(decision.shouldProceed)
        assertEquals(PetSpeechOutcome.VoiceUnavailable, decision.failureOutcome)
    }

    @Test
    fun successfulExactReadbackProceedsWithAppliedVoice() {
        val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
            requestedVoiceName = "yue-hk-x-yuc-local",
            matchingVoiceFound = true,
            setVoiceResult = 0,
            readbackVoiceName = "yue-hk-x-yuc-local",
            readbackNetwork = false,
            exceptionThrown = false
        )
        assertTrue(decision.shouldProceed)
        assertEquals("yue-hk-x-yuc-local", decision.effectiveVoiceName)
        assertFalse(decision.networkRequired)
        assertNull(decision.failureOutcome)
    }

    @Test
    fun exceptionDuringApplicationOrReadbackFailsVoiceUnavailable() {
        val decision = PetSpeechVoiceApplicationClassifier.evaluateVoiceApplication(
            requestedVoiceName = "yue-hk-x-yuc-local",
            matchingVoiceFound = true,
            setVoiceResult = 0,
            readbackVoiceName = "yue-hk-x-yuc-local",
            readbackNetwork = false,
            exceptionThrown = true
        )
        assertFalse(decision.shouldProceed)
        assertEquals(PetSpeechOutcome.VoiceUnavailable, decision.failureOutcome)
    }
}
