package expo.modules.petspeech

import android.app.Service
import org.junit.Assert.assertEquals
import org.junit.Test

class PetSpeechStartResultDecisionTest {

    @Test
    fun returnsStartStickyWhenHeld() {
        val result = PetSpeechStartResultDecision.computeStartResult(isHeld = true)
        assertEquals(Service.START_STICKY, result)
    }

    @Test
    fun returnsStartNotStickyWhenNotHeld() {
        val result = PetSpeechStartResultDecision.computeStartResult(isHeld = false)
        assertEquals(Service.START_NOT_STICKY, result)
    }
}
