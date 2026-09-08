package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PetSpeechPlayerLifecycleTest {

    @Test
    fun releaseCurrentDetachesPlayerAndReleasesItExactlyOnce() {
        val released = mutableListOf<String>()
        val lifecycle = PetSpeechPlayerLifecycle<String> { released.add(it) }

        lifecycle.current = "player-1"
        lifecycle.releaseCurrent()
        lifecycle.releaseCurrent()

        assertNull(lifecycle.current)
        assertEquals(listOf("player-1"), released)
    }
}
