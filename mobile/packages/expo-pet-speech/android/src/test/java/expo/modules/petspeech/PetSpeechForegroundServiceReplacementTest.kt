package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechForegroundServiceReplacementTest {

    @Test
    fun sameServiceReplacementUpdatesNotificationCancelsOldOwnerAndStopsOnlyOnTerminal() {
        val actions = mutableListOf<String>()
        var notificationText: String? = null
        var stopSelfCalled = false
        var stopForegroundCalled = false

        val manager = PetSpeechServiceReplacementDecisionHandler(
            onStopSelf = {
                stopSelfCalled = true
                actions.add("stopSelf")
            },
            onStopForeground = {
                stopForegroundCalled = true
                actions.add("stopForeground")
            },
            onUpdateNotification = { text ->
                notificationText = text
                actions.add("updateNotification:$text")
            }
        )

        // Step 1: Utterance 1 arrives (ownerId = 1)
        manager.onStartCommand(1L, "第一句")
        assertEquals("第一句", notificationText)
        assertEquals(1L, manager.activeOwnerId)
        assertFalse(stopSelfCalled)

        var req1Outcome: PetSpeechOutcome? = null
        manager.beginPlayback(1L, "ev-1", "第一句") { id, outcome ->
            req1Outcome = outcome
            actions.add("req1Outcome:$id:${outcome.name}")
        }

        // Step 2: Utterance 2 arrives (ownerId = 2) while Utterance 1 is playing
        manager.onStartCommand(2L, "第二句")
        assertEquals("第二句", notificationText)
        assertEquals(2L, manager.activeOwnerId)
        assertFalse(stopSelfCalled)
        assertFalse(stopForegroundCalled)

        var req2Outcome: PetSpeechOutcome? = null
        manager.beginPlayback(2L, "ev-2", "第二句") { id, outcome ->
            req2Outcome = outcome
            actions.add("req2Outcome:$id:${outcome.name}")
        }

        // Old owner 1 was cancelled during replacement without stopping service
        assertEquals(PetSpeechOutcome.Cancelled, req1Outcome)
        assertNull(req2Outcome)
        assertFalse(stopSelfCalled)
        assertFalse(stopForegroundCalled)

        // Step 3: Stale cancellation for owner 1 has no effect on owner 2
        manager.cancelSpeech(1L)
        assertNull(req2Outcome)
        assertFalse(stopSelfCalled)

        // Step 4: Utterance 2 completes playback normally
        manager.completePlayback(2L, PetSpeechOutcome.Spoken)

        assertEquals(PetSpeechOutcome.Spoken, req2Outcome)
        assertTrue(stopForegroundCalled)
        assertTrue(stopSelfCalled)
        assertNull(manager.activeOwnerId)
    }

    @Test
    fun cancelMatchingOwnerStopsForegroundAndSelfWhenActive() {
        var stopSelfCalled = false
        var stopForegroundCalled = false
        var settledOutcome: PetSpeechOutcome? = null

        val manager = PetSpeechServiceReplacementDecisionHandler(
            onStopSelf = { stopSelfCalled = true },
            onStopForeground = { stopForegroundCalled = true },
            onUpdateNotification = {}
        )

        manager.onStartCommand(10L, "單獨請求")
        manager.beginPlayback(10L, "ev-10", "單獨請求") { id, outcome ->
            settledOutcome = outcome
        }

        // Cancel matching active owner
        manager.cancelSpeech(10L)

        assertEquals(PetSpeechOutcome.Cancelled, settledOutcome)
        assertTrue(stopForegroundCalled)
        assertTrue(stopSelfCalled)
        assertNull(manager.activeOwnerId)
    }

    @Test
    fun heldSessionCompletePlaybackKeepsServiceAndSetsIdleNotification() {
        var stopSelfCalled = false
        var stopForegroundCalled = false
        var updatedNotification: String? = null

        val manager = PetSpeechServiceReplacementDecisionHandler(
            onStopSelf = { stopSelfCalled = true },
            onStopForeground = { stopForegroundCalled = true },
            onUpdateNotification = { updatedNotification = it }
        )

        manager.holdSession()
        manager.onStartCommand(100L, "語音播報")
        assertEquals("語音播報", updatedNotification)

        var completedOutcome: PetSpeechOutcome? = null
        manager.beginPlayback(100L, "ev-100", "語音播報") { _, outcome ->
            completedOutcome = outcome
        }

        manager.completePlayback(100L, PetSpeechOutcome.Spoken)

        assertEquals(PetSpeechOutcome.Spoken, completedOutcome)
        assertEquals("Pet voice connected", updatedNotification)
        assertFalse(stopForegroundCalled)
        assertFalse(stopSelfCalled)
        assertNull(manager.activeOwnerId)
    }

    @Test
    fun unheldSessionCompletePlaybackStillStopsSelf() {
        var stopSelfCalled = false
        var stopForegroundCalled = false

        val manager = PetSpeechServiceReplacementDecisionHandler(
            onStopSelf = { stopSelfCalled = true },
            onStopForeground = { stopForegroundCalled = true },
            onUpdateNotification = {}
        )

        manager.onStartCommand(200L, "播報後關閉")
        manager.beginPlayback(200L, "ev-200", "播報後關閉") { _, _ -> }
        manager.completePlayback(200L, PetSpeechOutcome.Spoken)

        assertTrue(stopForegroundCalled)
        assertTrue(stopSelfCalled)
    }

    @Test
    fun releaseSessionStopsIdleService() {
        var stopSelfCalled = false
        var stopForegroundCalled = false
        var updatedNotification: String? = null

        val manager = PetSpeechServiceReplacementDecisionHandler(
            onStopSelf = { stopSelfCalled = true },
            onStopForeground = { stopForegroundCalled = true },
            onUpdateNotification = { updatedNotification = it }
        )

        manager.holdSession()
        assertEquals("Pet voice connected", updatedNotification)
        assertFalse(stopForegroundCalled)
        assertFalse(stopSelfCalled)

        manager.releaseSession()
        assertTrue(stopForegroundCalled)
        assertTrue(stopSelfCalled)
    }

    @Test
    fun releaseSessionWhileUtteranceActiveCancelsUtteranceAndStops() {
        var stopSelfCalled = false
        var stopForegroundCalled = false
        var cancelledOutcome: PetSpeechOutcome? = null

        val manager = PetSpeechServiceReplacementDecisionHandler(
            onStopSelf = { stopSelfCalled = true },
            onStopForeground = { stopForegroundCalled = true },
            onUpdateNotification = {}
        )

        manager.holdSession()
        manager.onStartCommand(300L, "播報中釋放")
        manager.beginPlayback(300L, "ev-300", "播報中釋放") { _, outcome ->
            cancelledOutcome = outcome
        }

        manager.releaseSession()

        assertEquals(PetSpeechOutcome.Cancelled, cancelledOutcome)
        assertTrue(stopForegroundCalled)
        assertTrue(stopSelfCalled)
        assertNull(manager.activeOwnerId)
    }

    @Test
    fun heldSessionUpdateToReconnectingTextDoesNotStopForegroundAndRestoresHeldTextOnCompletePlayback() {
        var stopSelfCalled = false
        var stopForegroundCalled = false
        var updatedNotification: String? = null

        val manager = PetSpeechServiceReplacementDecisionHandler(
            onStopSelf = { stopSelfCalled = true },
            onStopForeground = { stopForegroundCalled = true },
            onUpdateNotification = { updatedNotification = it }
        )

        manager.holdSession()
        assertEquals(PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT, updatedNotification)

        // Update notification to reconnecting text while held
        manager.updateHeldNotification(PetSpeechForegroundStart.RECONNECTING_NOTIFICATION_TEXT)
        assertEquals(PetSpeechForegroundStart.RECONNECTING_NOTIFICATION_TEXT, updatedNotification)
        assertFalse(stopForegroundCalled)
        assertFalse(stopSelfCalled)

        // Utterance arrives during reconnecting
        manager.onStartCommand(400L, "斷線重連中播報")
        assertEquals("斷線重連中播報", updatedNotification)
        manager.beginPlayback(400L, "ev-400", "斷線重連中播報") { _, _ -> }

        // Completing playback restores the held reconnecting text, NOT idle connected
        manager.completePlayback(400L, PetSpeechOutcome.Spoken)
        assertEquals(PetSpeechForegroundStart.RECONNECTING_NOTIFICATION_TEXT, updatedNotification)
        assertFalse(stopForegroundCalled)
        assertFalse(stopSelfCalled)

        // Reconnect back to idle connected
        manager.updateHeldNotification(PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT)
        assertEquals(PetSpeechForegroundStart.IDLE_NOTIFICATION_TEXT, updatedNotification)
        assertFalse(stopForegroundCalled)
        assertFalse(stopSelfCalled)

        // Finally release session -> stops foreground and service
        manager.releaseSession()
        assertTrue(stopForegroundCalled)
        assertTrue(stopSelfCalled)
    }
}
