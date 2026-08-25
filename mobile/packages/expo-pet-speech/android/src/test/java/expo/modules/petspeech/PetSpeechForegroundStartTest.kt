package expo.modules.petspeech

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechForegroundStartTest {

    @Test
    fun tryStartForegroundReturnsTrueOnSuccess() {
        var called = false
        val result = PetSpeechForegroundStart.tryStartForeground {
            called = true
        }
        assertTrue(result)
        assertTrue(called)
    }

    @Test
    fun tryStartForegroundReturnsFalseOnStartNotAllowed() {
        val result = PetSpeechForegroundStart.tryStartForeground {
            throw IllegalStateException("ForegroundServiceStartNotAllowedException: startForeground not allowed")
        }
        assertFalse(result)
    }

    @Test
    fun tryStartForegroundReturnsFalseOnWrappedForegroundServiceStartNotAllowed() {
        val result = PetSpeechForegroundStart.tryStartForeground {
            throw RuntimeException("Wrapped", ClassNotFoundException("android.app.ForegroundServiceStartNotAllowedException"))
        }
        assertFalse(result)
    }
}
