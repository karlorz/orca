package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechEngineLifecycleOwnerTest {

    class MockEngine(val id: String) {
        var isStopped = false
        var isShutdown = false
        var stopCount = 0
        var shutdownCount = 0

        fun stop() {
            isStopped = true
            stopCount++
        }

        fun shutdown() {
            isShutdown = true
            shutdownCount++
        }
    }

    @Test
    fun queryVoicesLifecycleReleasesEngineAfterResolution() {
        val engine = MockEngine("query-engine")
        var released = false

        val lifecycle = PetSpeechEngineLifecycle(
            engine = engine,
            onStop = { engine.stop() },
            onShutdown = {
                engine.shutdown()
                released = true
            }
        )

        assertFalse(lifecycle.isReleased)
        lifecycle.release()
        assertTrue(lifecycle.isReleased)
        assertTrue(engine.isShutdown)
        assertEquals(1, engine.shutdownCount)

        // Multiple release is idempotent
        lifecycle.release()
        assertEquals(1, engine.shutdownCount)
    }

    @Test
    fun synthesisTerminalLifecycleReleasesEngineOnSuccess() {
        val engine = MockEngine("synth-engine-1")
        val lifecycle = PetSpeechEngineLifecycle(
            engine = engine,
            onStop = { engine.stop() },
            onShutdown = { engine.shutdown() }
        )

        lifecycle.onSynthesisComplete()
        assertTrue(lifecycle.isReleased)
        assertTrue(engine.isShutdown)
        assertEquals(1, engine.shutdownCount)
    }

    @Test
    fun synthesisTerminalLifecycleReleasesEngineOnFailure() {
        val engine = MockEngine("synth-engine-2")
        val lifecycle = PetSpeechEngineLifecycle(
            engine = engine,
            onStop = { engine.stop() },
            onShutdown = { engine.shutdown() }
        )

        lifecycle.onSynthesisFailed()
        assertTrue(lifecycle.isReleased)
        assertTrue(engine.isShutdown)
        assertEquals(1, engine.shutdownCount)
    }

    @Test
    fun cancellationHaltsAndShutsDownEnginePromptly() {
        val engine = MockEngine("synth-engine-3")
        val lifecycle = PetSpeechEngineLifecycle(
            engine = engine,
            onStop = { engine.stop() },
            onShutdown = { engine.shutdown() }
        )

        lifecycle.onCancelled()
        assertTrue(lifecycle.isReleased)
        assertTrue(engine.isStopped)
        assertTrue(engine.isShutdown)
        assertEquals(1, engine.stopCount)
        assertEquals(1, engine.shutdownCount)
    }

    @Test
    fun oldEngineTeardownDoesNotAffectNewerEngine() {
        val engine1 = MockEngine("engine-1")
        val engine2 = MockEngine("engine-2")

        val lifecycle1 = PetSpeechEngineLifecycle(engine1, { engine1.stop() }, { engine1.shutdown() })
        val lifecycle2 = PetSpeechEngineLifecycle(engine2, { engine2.stop() }, { engine2.shutdown() })

        lifecycle1.release()

        assertTrue(engine1.isShutdown)
        assertFalse(engine2.isShutdown)
        assertFalse(lifecycle2.isReleased)
    }
}
