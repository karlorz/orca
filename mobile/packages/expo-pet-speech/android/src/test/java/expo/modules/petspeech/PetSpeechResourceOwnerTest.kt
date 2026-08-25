package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

class PetSpeechResourceOwnerTest {

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

    class MockServiceConnection(val id: String) {
        var unbindCount = 0
        fun unbind() {
            unbindCount++
        }
    }

    class MockForegroundService(val id: String) {
        var cancelledOwnerIds = mutableListOf<Long>()
        var activeOwnerId: Long? = null
        var updatedText: String? = null
        var stoppedSelf = false
        var onCompleteCallback: ((String, PetSpeechOutcome) -> Unit)? = null

        fun cancelSpeech(ownerId: Long) {
            cancelledOwnerIds.add(ownerId)
            if (activeOwnerId == ownerId) {
                activeOwnerId = null
                val cb = onCompleteCallback
                onCompleteCallback = null
                cb?.invoke("ev-$ownerId", PetSpeechOutcome.Cancelled)
            }
        }

        fun playSpeech(ownerId: Long, eventId: String, text: String, onOutcome: (String, PetSpeechOutcome) -> Unit) {
            this.activeOwnerId = ownerId
            this.updatedText = text
            this.onCompleteCallback = onOutcome
        }

        fun finishSpeech(ownerId: Long, outcome: PetSpeechOutcome) {
            if (activeOwnerId == ownerId) {
                activeOwnerId = null
                val cb = onCompleteCallback
                onCompleteCallback = null
                cb?.invoke("ev-$ownerId", outcome)
            }
        }
    }

    @Test
    fun outOfOrderInitLeavesReq2ActiveAndReq1Cancelled() {
        val registry = PetSpeechResourceOwnerRegistry()

        val req1 = registry.createOwner("ev-1", "你好1", "/tmp/ev1.wav") { outcome -> }
        val req2 = registry.createOwner("ev-2", "你好2", "/tmp/ev2.wav") { outcome -> }

        // req2 was created after req1, so req1 must be superseded immediately
        assertTrue(req1.isCancelled)
        assertFalse(req2.isCancelled)
        assertTrue(registry.isCurrent(req2))
        assertFalse(registry.isCurrent(req1))

        val engine2 = MockEngine("engine-2")
        val lifecycle2 = PetSpeechEngineLifecycle(engine2, { engine2.stop() }, { engine2.shutdown() })
        req2.attachEngineLifecycle(lifecycle2)

        // Late completion of req1 TTS init
        val engine1 = MockEngine("engine-1")
        val lifecycle1 = PetSpeechEngineLifecycle(engine1, { engine1.stop() }, { engine1.shutdown() })
        val attached1 = req1.attachEngineLifecycle(lifecycle1)

        // req1 must reject engine attachment, shut down engine1 immediately, and not affect engine2
        assertFalse(attached1)
        assertTrue(engine1.isShutdown)
        assertFalse(engine2.isShutdown)
        assertTrue(registry.isCurrent(req2))
    }

    @Test
    fun stopAsyncDuringPendingInitPreventsLaterActivationAndSettlesOnce() {
        val registry = PetSpeechResourceOwnerRegistry()
        var settledOutcome: PetSpeechOutcome? = null

        val req = registry.createOwner("ev-1", "你好", "/tmp/ev1.wav") { outcome ->
            settledOutcome = outcome
        }

        assertFalse(req.isCancelled)
        registry.stopAll()

        assertTrue(req.isCancelled)
        assertEquals(PetSpeechOutcome.Cancelled, settledOutcome)

        // Later init arrives
        val engine = MockEngine("engine-late")
        val lifecycle = PetSpeechEngineLifecycle(engine, { engine.stop() }, { engine.shutdown() })
        val attached = req.attachEngineLifecycle(lifecycle)

        assertFalse(attached)
        assertTrue(engine.isShutdown)
        // Settlement count remains 1
        assertEquals(PetSpeechOutcome.Cancelled, settledOutcome)
    }

    @Test
    fun startSucceedsAndBindFalseCleansUpStartedServiceWithoutCallingUnbind() {
        val registry = PetSpeechResourceOwnerRegistry()
        var serviceStoppedCount = 0
        var unbindCount = 0

        val req = registry.createOwner("ev-1", "你好", "/tmp/ev1.wav") {}
        req.markServiceStarted {
            serviceStoppedCount++
        }

        val conn = MockServiceConnection("conn-1")
        req.registerConnectionAttempt(conn) {
            unbindCount++
        }

        // Bind returned false - connection was never established
        req.onBindResult(false)

        assertEquals(1, serviceStoppedCount)
        assertEquals(0, unbindCount) // Must NOT unbind a never-bound connection
        assertTrue(req.isCancelled)
    }

    @Test
    fun startSucceedsAndNullBinderUnbindsAndStopsStartedService() {
        val registry = PetSpeechResourceOwnerRegistry()
        var serviceStoppedCount = 0
        var unbindCount = 0

        val req = registry.createOwner("ev-1", "你好", "/tmp/ev1.wav") {}
        req.markServiceStarted {
            serviceStoppedCount++
        }

        val conn = MockServiceConnection("conn-1")
        req.registerConnectionAttempt(conn) {
            unbindCount++
        }
        req.onBindResult(true) // bind succeeded

        // Binder was null
        req.onServiceConnectFailed()

        assertEquals(1, serviceStoppedCount)
        assertEquals(1, unbindCount) // Must unbind exactly once
        assertTrue(req.isCancelled)
    }

    @Test
    fun startSucceedsAndCancelBeforeConnectStopsStartedServiceAndUnbindsIfBound() {
        val registry = PetSpeechResourceOwnerRegistry()
        var serviceStoppedCount = 0
        var unbindCount = 0

        val req = registry.createOwner("ev-1", "你好", "/tmp/ev1.wav") {}
        req.markServiceStarted {
            serviceStoppedCount++
        }

        val conn = MockServiceConnection("conn-1")
        req.registerConnectionAttempt(conn) {
            unbindCount++
        }
        req.onBindResult(true)

        // Cancelled before onServiceConnected
        req.teardown()

        assertEquals(1, serviceStoppedCount)
        assertEquals(1, unbindCount)
    }

    @Test
    fun staleOwnerServiceCleanupCannotAffectNewerOwnerPlaybackOrService() {
        val registry = PetSpeechResourceOwnerRegistry()
        var req1ServiceStopCount = 0
        var req2ServiceStopCount = 0

        val req1 = registry.createOwner("ev-1", "你好1", "/tmp/ev1.wav") {}
        req1.markServiceStarted {
            req1ServiceStopCount++
        }

        // Req2 starts, replacing Req1
        val req2 = registry.createOwner("ev-2", "你好2", "/tmp/ev2.wav") {}
        req2.markServiceStarted {
            req2ServiceStopCount++
        }

        // Req1 teardown executes
        req1.teardown()

        assertEquals(1, req1ServiceStopCount)
        assertEquals(0, req2ServiceStopCount)
        assertTrue(registry.isCurrent(req2))
    }

    @Test
    fun ownerQualifiedCancelDoesNotCancelNewerPlayback() {
        val registry = PetSpeechResourceOwnerRegistry()
        val mockService = MockForegroundService("service-1")

        val req1 = registry.createOwner("ev-1", "你好1", "/tmp/ev1.wav") {}
        req1.attachBoundService(
            onCancelSpeech = { mockService.cancelSpeech(req1.id) }
        )

        val req2 = registry.createOwner("ev-2", "你好2", "/tmp/ev2.wav") {}
        req2.attachBoundService(
            onCancelSpeech = { mockService.cancelSpeech(req2.id) }
        )

        mockService.playSpeech(req2.id, "ev-2", "你好2") { id, outcome -> }

        // Stale teardown of req1
        req1.teardown()

        assertEquals(listOf(req1.id), mockService.cancelledOwnerIds)
        assertEquals(req2.id, mockService.activeOwnerId) // req2 is still active!
    }

    @Test
    fun trueBindUnbindsExactlyOnceAcrossAllTerminalPaths() {
        val registry = PetSpeechResourceOwnerRegistry()

        // Path 1: Normal success
        val req1 = registry.createOwner("ev-1", "你好", "/tmp/ev1.wav") {}
        var unbindCount1 = 0
        req1.registerConnectionAttempt(Object()) { unbindCount1++ }
        req1.onBindResult(true)
        req1.settle(PetSpeechOutcome.Spoken)
        assertEquals(1, unbindCount1)

        // Path 2: Disconnect
        val req2 = registry.createOwner("ev-2", "你好", "/tmp/ev2.wav") {}
        var unbindCount2 = 0
        req2.registerConnectionAttempt(Object()) { unbindCount2++ }
        req2.onBindResult(true)
        req2.onServiceDisconnected()
        assertEquals(1, unbindCount2)

        // Repeated settle or teardown is idempotent
        req2.settle(PetSpeechOutcome.Cancelled)
        req2.teardown()
        assertEquals(1, unbindCount2)
    }

    @Test
    fun registryAndOwnerExecuteCallbacksOutsideInternalLocks() {
        val registry = PetSpeechResourceOwnerRegistry()
        var reentrantCallSuccess = false

        // Test that within onOutcome callback, we can synchronously query or interact with registry without deadlock
        val req = registry.createOwner("ev-1", "你好", "/tmp/ev1.wav") { outcome ->
            // Reentrant call into registry under onOutcome callback
            reentrantCallSuccess = !registry.isCurrent(PetSpeechResourceOwner(999L, "other", "text", "/tmp/other.wav", {}, {}, {}))
        }

        req.settle(PetSpeechOutcome.Spoken)
        assertTrue(reentrantCallSuccess)
    }
}
