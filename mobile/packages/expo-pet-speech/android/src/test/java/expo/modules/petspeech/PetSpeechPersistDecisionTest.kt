package expo.modules.petspeech

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PetSpeechPersistDecisionTest {

    @Test
    fun holdHonestyMarksHeldOnlyAfterStartForegroundSucceeds() {
        assertTrue(PetSpeechHoldHonestyDecision.shouldMarkHeld(true))
        assertFalse(PetSpeechHoldHonestyDecision.shouldMarkHeld(false))
        assertTrue(PetSpeechHoldHonestyDecision.shouldKeepHeldOnVisibility(keepHold = true))
        assertFalse(PetSpeechHoldHonestyDecision.shouldKeepHeldOnVisibility(keepHold = false))
    }

    @Test
    fun pausePostsResumeChipAndMasterOffCancelsAll() {
        assertEquals(
            PetSpeechReleaseAftermathDecision.Aftermath.POST_RESUME_CHIP,
            PetSpeechReleaseAftermathDecision.decide(PetSpeechReleaseAftermathDecision.Reason.PAUSE)
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Aftermath.CANCEL_ALL,
            PetSpeechReleaseAftermathDecision.decide(PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF)
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Aftermath.CANCEL_ALL,
            PetSpeechReleaseAftermathDecision.decide(PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE)
        )
    }

    @Test
    fun masterOffAndJsReleaseCancelChipAndMediaStyleWithoutHoldOrTts() {
        val reasons = listOf(
            PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF,
            PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE
        )
        for (reason in reasons) {
            val contract = PetSpeechReleaseAftermathDecision.contract(reason)
            val plan = PetSpeechReleaseAftermathDecision.notificationPlan(reason)
            assertEquals(PetSpeechReleaseAftermathDecision.Aftermath.CANCEL_ALL, contract.aftermath)
            assertTrue(contract.cancelResumeChip)
            assertTrue(contract.cancelMediaStyle)
            assertEquals(
                PetSpeechReleaseAftermathDecision.ACTION_RELEASE_SESSION,
                contract.serviceAction
            )
            assertFalse(contract.reacquireHold)
            assertFalse(contract.startTts)
            assertFalse(plan.showFgs)
            assertFalse(plan.showResumeChip)
            assertFalse(plan.showServiceRow)
            assertTrue(contract.serviceAction != PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION)
            assertFalse(PetSpeechHoldCommandDecision.shouldStartTts(contract.serviceAction))
            assertFalse(PetSpeechHoldCommandDecision.isHoldOnlyAction(contract.serviceAction))
        }
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE,
            PetSpeechReleaseAftermathDecision.parseReason(null)
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF,
            PetSpeechReleaseAftermathDecision.parseReason("MASTER_OFF")
        )
    }

    @Test
    fun notificationPlanWhileHeldOptionallyShowsServiceRow() {
        val withRow = PetSpeechNotificationSetDecision.whileHeld(showServiceRow = true)
        assertTrue(withRow.showFgs)
        assertTrue(withRow.showServiceRow)
        assertFalse(withRow.showResumeChip)

        val hidden = PetSpeechNotificationSetDecision.whileHeld(showServiceRow = false)
        assertTrue(hidden.showFgs)
        assertFalse(hidden.showServiceRow)
        assertFalse(hidden.showResumeChip)
    }

    @Test
    fun notificationPlanAfterPauseShowsOnlyChip() {
        val plan = PetSpeechNotificationSetDecision.afterPause()
        assertFalse(plan.showFgs)
        assertFalse(plan.showServiceRow)
        assertTrue(plan.showResumeChip)
    }

    @Test
    fun persistWriteOffReleasesWithoutHoldOrTts() {
        val persistOff = PetSpeechPersistSettingsWriteDecision.releaseReason(
            persistEnabled = false,
            masterEnabled = true
        )
        assertEquals(PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP, persistOff)
        assertFalse(PetSpeechPersistSettingsWriteDecision.shouldStartTts(persistOff))
        assertFalse(PetSpeechPersistSettingsWriteDecision.shouldReacquireHold(persistOff))
        val persistOffContract = PetSpeechReleaseAftermathDecision.contract(persistOff!!)
        assertTrue(persistOffContract.cancelResumeChip)
        assertTrue(persistOffContract.cancelMediaStyle)
        assertEquals(
            PetSpeechReleaseAftermathDecision.ACTION_RELEASE_SESSION,
            persistOffContract.serviceAction
        )
        assertFalse(
            PetSpeechReleaseAftermathDecision.notificationPlan(persistOff).showResumeChip
        )

        val masterOff = PetSpeechPersistSettingsWriteDecision.releaseReason(
            persistEnabled = true,
            masterEnabled = false
        )
        assertEquals(PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF, masterOff)
        val bothOff = PetSpeechPersistSettingsWriteDecision.releaseReason(
            persistEnabled = false,
            masterEnabled = false
        )
        assertEquals(PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF, bothOff)
        assertEquals(
            null,
            PetSpeechPersistSettingsWriteDecision.releaseReason(
                persistEnabled = true,
                masterEnabled = true
            )
        )
        assertEquals(
            null,
            PetSpeechPersistSettingsWriteDecision.releaseReason(
                persistEnabled = null,
                masterEnabled = null
            )
        )
        assertFalse(PetSpeechPersistSettingsWriteDecision.shouldStartTts(null))
        assertFalse(PetSpeechPersistSettingsWriteDecision.shouldReacquireHold(null))
        assertTrue(PetSpeechPersistSettingsWriteDecision.mayShowServiceRowAfterWrite(null))
        assertFalse(PetSpeechPersistSettingsWriteDecision.mayShowServiceRowAfterWrite(persistOff))
        assertFalse(PetSpeechPersistSettingsWriteDecision.mayShowServiceRowAfterWrite(masterOff))
    }

    @Test
    fun notificationPlanAfterMasterOffShowsNothing() {
        val plan = PetSpeechNotificationSetDecision.afterMasterOff()
        assertFalse(plan.showFgs)
        assertFalse(plan.showServiceRow)
        assertFalse(plan.showResumeChip)
    }

    @Test
    fun homeScreenOffLockKeepHoldWhenPersistAndMasterOn() {
        for (event in PetSpeechVisibilityHoldDecision.Event.values()) {
            val held = PetSpeechVisibilityHoldDecision.decide(
                event,
                persistEnabled = true,
                masterEnabled = true,
                sessionHeld = true
            )
            assertTrue(held.keepHold)
            assertFalse(held.releaseSession)
            assertFalse(held.startForeground)
            assertFalse(held.startForegroundFromReceiver)
            assertTrue(held.fgsIsMediaStyle)
            assertFalse(held.startTts)
            val plan = PetSpeechVisibilityHoldDecision.notificationPlan(
                keepHold = true,
                showServiceRow = false
            )
            assertTrue(plan.showFgs)
            assertFalse(plan.showResumeChip)
            assertEquals(
                PetSpeechNotificationSetDecision.FGS_NOTIFICATION_ID,
                4040
            )
        }
        val idle = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.LOCK,
            persistEnabled = true,
            masterEnabled = true,
            sessionHeld = false
        )
        assertFalse(idle.keepHold)
        assertFalse(idle.releaseSession)
        assertFalse(idle.startForeground)
        assertFalse(idle.startForegroundFromReceiver)
        assertFalse(idle.fgsIsMediaStyle)
        assertFalse(PetSpeechBootResumeDecision.mayStartMediaPlaybackFromReceiver())
        assertFalse(PetSpeechBootResumeDecision.isBootAction(PetSpeechVisibilityHoldDecision.ACTION_SCREEN_OFF))
        assertFalse(PetSpeechBootResumeDecision.isBootAction(PetSpeechVisibilityHoldDecision.ACTION_USER_PRESENT))
        assertTrue(PetSpeechVisibilityHoldDecision.isVisibilityAction(PetSpeechVisibilityHoldDecision.ACTION_SCREEN_OFF))
        assertEquals(
            PetSpeechVisibilityHoldDecision.Event.HOME,
            PetSpeechVisibilityHoldDecision.eventFromAction(
                PetSpeechVisibilityHoldDecision.ACTION_CLOSE_SYSTEM_DIALOGS
            )
        )
        assertEquals(
            PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF,
            PetSpeechVisibilityHoldDecision.eventFromAction(
                PetSpeechVisibilityHoldDecision.ACTION_SCREEN_OFF
            )
        )
        assertEquals(
            PetSpeechVisibilityHoldDecision.Event.LOCK,
            PetSpeechVisibilityHoldDecision.eventFromAction(
                PetSpeechVisibilityHoldDecision.ACTION_USER_PRESENT
            )
        )
        val persistOffHome = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.HOME,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = true
        )
        assertTrue(persistOffHome.keepHold)
        assertFalse(persistOffHome.releaseSession)
        assertFalse(persistOffHome.startForeground)
        assertTrue(persistOffHome.fgsIsMediaStyle)
        assertFalse(persistOffHome.startTts)
        val masterOff = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF,
            persistEnabled = true,
            masterEnabled = false,
            sessionHeld = true
        )
        assertFalse(masterOff.keepHold)
        assertTrue(masterOff.releaseSession)
        assertFalse(masterOff.startForeground)
        assertFalse(masterOff.startForegroundFromReceiver)
        assertFalse(masterOff.fgsIsMediaStyle)
        val heldActions = PetSpeechVisibilityHoldDecision.mediaActionsWhileHeld(keepHold = true)
        assertTrue(heldActions != 0L)
        assertEquals(PetSpeechMediaHoldDecision.playbackActions(), heldActions)
        assertEquals(0L, PetSpeechVisibilityHoldDecision.mediaActionsWhileHeld(keepHold = false))
    }

    @Test
    fun persistOffScreenOffAndLockKeepHoldTheSameAsHome() {
        val home = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.HOME,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = true
        )
        assertEquals(
            listOf(
                PetSpeechVisibilityHoldDecision.Event.HOME,
                PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF,
                PetSpeechVisibilityHoldDecision.Event.LOCK
            ),
            PetSpeechVisibilityHoldDecision.persistOffVisibilityEvents()
        )
        for (event in PetSpeechVisibilityHoldDecision.persistOffVisibilityEvents()) {
            val decided = PetSpeechVisibilityHoldDecision.decide(
                event,
                persistEnabled = false,
                masterEnabled = true,
                sessionHeld = true
            )
            assertEquals(home.keepHold, decided.keepHold)
            assertEquals(home.releaseSession, decided.releaseSession)
            assertEquals(home.startForeground, decided.startForeground)
            assertEquals(home.startForegroundFromReceiver, decided.startForegroundFromReceiver)
            assertEquals(home.fgsIsMediaStyle, decided.fgsIsMediaStyle)
            assertEquals(home.startTts, decided.startTts)
            assertTrue(decided.keepHold)
            assertFalse(decided.releaseSession)
            assertFalse(decided.startForeground)
            assertFalse(decided.startForegroundFromReceiver)
            assertFalse(PetSpeechVisibilityHoldDecision.mayStartMediaPlaybackFromVisibilityReceiver())
            assertFalse(PetSpeechBootResumeDecision.mayStartMediaPlaybackFromReceiver())
        }
        val screenOff = PetSpeechVisibilityHoldDecision.applyAction(
            PetSpeechVisibilityHoldDecision.ACTION_SCREEN_OFF,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = true
        )
        val lock = PetSpeechVisibilityHoldDecision.applyAction(
            PetSpeechVisibilityHoldDecision.ACTION_USER_PRESENT,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = true
        )
        assertTrue(screenOff != null && screenOff.keepHold)
        assertTrue(lock != null && lock.keepHold)
        assertFalse(screenOff!!.startForegroundFromReceiver)
        assertFalse(lock!!.startForegroundFromReceiver)
        val masterOffLock = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.LOCK,
            persistEnabled = false,
            masterEnabled = false,
            sessionHeld = true
        )
        assertFalse(masterOffLock.keepHold)
        assertTrue(masterOffLock.releaseSession)
        assertFalse(masterOffLock.startForeground)
        assertFalse(masterOffLock.startForegroundFromReceiver)
        assertEquals(
            null,
            PetSpeechVisibilityHoldDecision.applyAction(
                PetSpeechBootResumeDecision.ACTION_BOOT_COMPLETED,
                persistEnabled = false,
                masterEnabled = true,
                sessionHeld = true
            )
        )
        for (event in listOf(
            PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF,
            PetSpeechVisibilityHoldDecision.Event.LOCK
        )) {
            val idle = PetSpeechVisibilityHoldDecision.decide(
                event,
                persistEnabled = false,
                masterEnabled = true,
                sessionHeld = false
            )
            assertFalse(idle.keepHold)
            assertFalse(idle.releaseSession)
            assertFalse(idle.startForeground)
            assertFalse(idle.startForegroundFromReceiver)
            assertFalse(idle.startTts)
        }
        val persistOffKeepHost = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = true,
            keepWhenNoHost = true
        )
        assertTrue(persistOffKeepHost.keepHold)
        assertFalse(persistOffKeepHost.startForeground)
        assertFalse(persistOffKeepHost.startForegroundFromReceiver)
    }

    @Test
    fun persistOnKeepWhenNoHostScreenOffAndLockKeepHold() {
        assertEquals(
            listOf(
                PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF,
                PetSpeechVisibilityHoldDecision.Event.LOCK
            ),
            PetSpeechVisibilityHoldDecision.persistOnKeepHostVisibilityEvents()
        )
        assertFalse(PetSpeechVisibilityHoldDecision.keepWhenNoHostNeverStartsForeground(true))
        assertFalse(PetSpeechVisibilityHoldDecision.keepWhenNoHostNeverStartsForeground(false))
        for (event in PetSpeechVisibilityHoldDecision.persistOnKeepHostVisibilityEvents()) {
            val held = PetSpeechVisibilityHoldDecision.decide(
                event,
                persistEnabled = true,
                masterEnabled = true,
                sessionHeld = true,
                keepWhenNoHost = true
            )
            assertTrue(held.keepHold)
            assertFalse(held.releaseSession)
            assertFalse(held.startForeground)
            assertFalse(held.startForegroundFromReceiver)
            assertTrue(held.fgsIsMediaStyle)
            assertFalse(held.startTts)
            assertFalse(PetSpeechVisibilityHoldDecision.mayStartMediaPlaybackFromVisibilityReceiver())
            assertFalse(PetSpeechBootResumeDecision.mayStartMediaPlaybackFromReceiver())
            val plan = PetSpeechVisibilityHoldDecision.notificationPlan(
                keepHold = true,
                showServiceRow = false
            )
            assertTrue(plan.showFgs)
            assertFalse(plan.showResumeChip)
        }
        val screenOff = PetSpeechVisibilityHoldDecision.applyAction(
            PetSpeechVisibilityHoldDecision.ACTION_SCREEN_OFF,
            persistEnabled = true,
            masterEnabled = true,
            sessionHeld = true,
            keepWhenNoHost = true
        )
        val lock = PetSpeechVisibilityHoldDecision.applyAction(
            PetSpeechVisibilityHoldDecision.ACTION_USER_PRESENT,
            persistEnabled = true,
            masterEnabled = true,
            sessionHeld = true,
            keepWhenNoHost = true
        )
        assertTrue(screenOff != null && screenOff.keepHold)
        assertTrue(lock != null && lock.keepHold)
        assertFalse(screenOff!!.startForegroundFromReceiver)
        assertFalse(lock!!.startForegroundFromReceiver)
        val masterOff = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.LOCK,
            persistEnabled = true,
            masterEnabled = false,
            sessionHeld = true,
            keepWhenNoHost = true
        )
        assertFalse(masterOff.keepHold)
        assertTrue(masterOff.releaseSession)
        assertFalse(masterOff.startForeground)
        assertFalse(masterOff.startForegroundFromReceiver)
        val idle = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF,
            persistEnabled = true,
            masterEnabled = true,
            sessionHeld = false,
            keepWhenNoHost = true
        )
        assertFalse(idle.keepHold)
        assertFalse(idle.startForeground)
        assertFalse(idle.startForegroundFromReceiver)
        val homeTwin = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.HOME,
            persistEnabled = true,
            masterEnabled = true,
            sessionHeld = true,
            keepWhenNoHost = true
        )
        assertTrue(homeTwin.keepHold)
        assertFalse(homeTwin.startForeground)
        assertEquals(
            PetSpeechMediaHoldDecision.playbackActions(),
            PetSpeechVisibilityHoldDecision.mediaActionsWhileHeld(keepHold = true)
        )
        val overlayLock = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.LOCK,
            persistEnabled = true,
            masterEnabled = true,
            sessionHeld = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true
        )
        assertTrue(overlayLock.keepHold)
        assertFalse(overlayLock.startForeground)
        assertFalse(overlayLock.startForegroundFromReceiver)
        assertFalse(PetSpeechOverlayPermissionDecision.mayStartOrHoldForeground())
    }

    @Test
    fun persistOffOverlayLockKeepsHoldAndNeverStartsForeground() {
        assertEquals(
            listOf(
                PetSpeechVisibilityHoldDecision.Event.LOCK,
                PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF
            ),
            PetSpeechVisibilityHoldDecision.persistOffOverlayVisibilityEvents()
        )
        assertFalse(PetSpeechVisibilityHoldDecision.overlayNeverStartsForeground(true))
        assertFalse(PetSpeechVisibilityHoldDecision.overlayNeverStartsForeground(false))
        for (event in PetSpeechVisibilityHoldDecision.persistOffOverlayVisibilityEvents()) {
            val held = PetSpeechVisibilityHoldDecision.decide(
                event,
                persistEnabled = false,
                masterEnabled = true,
                sessionHeld = true,
                overlayWhileSpeaking = true
            )
            assertTrue(held.keepHold)
            assertFalse(held.releaseSession)
            assertFalse(held.startForeground)
            assertFalse(held.startForegroundFromReceiver)
            assertTrue(held.fgsIsMediaStyle)
            assertFalse(held.startTts)
            assertFalse(PetSpeechVisibilityHoldDecision.mayStartMediaPlaybackFromVisibilityReceiver())
            assertFalse(PetSpeechBootResumeDecision.mayStartMediaPlaybackFromReceiver())
        }
        val lock = PetSpeechVisibilityHoldDecision.applyAction(
            PetSpeechVisibilityHoldDecision.ACTION_USER_PRESENT,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = true,
            overlayWhileSpeaking = true
        )
        assertTrue(lock != null && lock.keepHold)
        assertFalse(lock!!.startForegroundFromReceiver)
        val homeTwin = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.HOME,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = true,
            overlayWhileSpeaking = true
        )
        assertTrue(homeTwin.keepHold)
        assertFalse(homeTwin.startForeground)
        val masterOff = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.LOCK,
            persistEnabled = false,
            masterEnabled = false,
            sessionHeld = true,
            overlayWhileSpeaking = true
        )
        assertFalse(masterOff.keepHold)
        assertTrue(masterOff.releaseSession)
        assertFalse(masterOff.startForeground)
        assertFalse(masterOff.startForegroundFromReceiver)
        val idle = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.LOCK,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = false,
            overlayWhileSpeaking = true
        )
        assertFalse(idle.keepHold)
        assertFalse(idle.startForeground)
        assertFalse(idle.startForegroundFromReceiver)
        val persistOffOverlayKeepHost = PetSpeechVisibilityHoldDecision.decide(
            PetSpeechVisibilityHoldDecision.Event.LOCK,
            persistEnabled = false,
            masterEnabled = true,
            sessionHeld = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true
        )
        assertTrue(persistOffOverlayKeepHost.keepHold)
        assertFalse(persistOffOverlayKeepHost.startForeground)
        assertFalse(persistOffOverlayKeepHost.startForegroundFromReceiver)
    }

    @Test
    fun bootNeverStartsForegroundAndPostsResumeOnlyWhenPersistAndMasterOn() {
        val on = PetSpeechBootResumeDecision.decide(persistEnabled = true, masterEnabled = true)
        assertTrue(on.postResumeNotification)
        assertFalse(on.startForeground)
        assertFalse(on.startMediaPlaybackForeground)
        assertFalse(PetSpeechBootResumeDecision.mayStartMediaPlaybackFromReceiver())
        assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, on.tapAction)
        assertFalse(on.tapStartsTts)
        val onPlan = PetSpeechBootResumeDecision.notificationPlan(
            persistEnabled = true,
            masterEnabled = true
        )
        assertFalse(onPlan.showFgs)
        assertFalse(onPlan.showServiceRow)
        assertTrue(onPlan.showResumeChip)

        val persistOff = PetSpeechBootResumeDecision.decide(persistEnabled = false, masterEnabled = true)
        assertFalse(persistOff.postResumeNotification)
        assertFalse(persistOff.startForeground)
        assertFalse(persistOff.startMediaPlaybackForeground)
        assertEquals(null, persistOff.tapAction)
        assertFalse(persistOff.tapStartsTts)

        val masterOff = PetSpeechBootResumeDecision.decide(persistEnabled = true, masterEnabled = false)
        assertFalse(masterOff.postResumeNotification)
        assertFalse(masterOff.startForeground)
        assertFalse(masterOff.startMediaPlaybackForeground)
        assertEquals(null, masterOff.tapAction)
        assertFalse(masterOff.tapStartsTts)
        assertTrue(PetSpeechBootResumeDecision.isBootAction(PetSpeechBootResumeDecision.ACTION_BOOT_COMPLETED))
        assertTrue(
            PetSpeechBootResumeDecision.isBootAction(
                PetSpeechBootResumeDecision.ACTION_LOCKED_BOOT_COMPLETED
            )
        )
        assertFalse(PetSpeechBootResumeDecision.isBootAction(null))
        assertFalse(PetSpeechBootResumeDecision.isBootAction("android.intent.action.MY_PACKAGE_REPLACED"))
        assertEquals(
            listOf(
                PetSpeechBootResumeDecision.ACTION_BOOT_COMPLETED,
                PetSpeechBootResumeDecision.ACTION_LOCKED_BOOT_COMPLETED
            ),
            PetSpeechBootResumeDecision.declaredBootActions()
        )
        assertEquals(
            PetSpeechBootResumeDecision.MEDIA_PLAYBACK_FOREGROUND_TYPE,
            "mediaPlayback"
        )
        val keepHostOn = PetSpeechBootResumeDecision.decide(
            persistEnabled = true,
            masterEnabled = true,
            keepWhenNoHost = true
        )
        assertTrue(keepHostOn.postResumeNotification)
        assertFalse(keepHostOn.startForeground)
        assertFalse(keepHostOn.startMediaPlaybackForeground)
        assertFalse(PetSpeechBootResumeDecision.receiverMayStartForeground(keepWhenNoHost = true))
        assertFalse(keepHostOn.tapStartsTts)
        val keepHostPlan = PetSpeechBootResumeDecision.notificationPlan(
            persistEnabled = true,
            masterEnabled = true
        )
        assertFalse(keepHostPlan.showFgs)
        assertFalse(keepHostPlan.showServiceRow)
        assertTrue(keepHostPlan.showResumeChip)
    }

    @Test
    fun overlayRequestsPermissionOnlyWhenSwitchTurnsOnAndShowsOnlyWhileSpeaking() {
        assertFalse(PetSpeechOverlayPermissionDecision.mayStartOrHoldForeground())
        val overlayBoot = PetSpeechBootResumeDecision.decide(
            persistEnabled = true,
            masterEnabled = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true
        )
        assertFalse(overlayBoot.startForeground)
        assertFalse(overlayBoot.startMediaPlaybackForeground)
        assertFalse(PetSpeechBootResumeDecision.mayStartMediaPlaybackFromReceiver())
        val overlayPersistOff = PetSpeechBootResumeDecision.decide(
            persistEnabled = false,
            masterEnabled = true,
            overlayWhileSpeaking = true
        )
        assertFalse(overlayPersistOff.postResumeNotification)
        assertFalse(overlayPersistOff.startForeground)
        assertFalse(overlayPersistOff.startMediaPlaybackForeground)
        assertEquals(null, overlayPersistOff.tapAction)
        assertTrue(PetSpeechOverlayPermissionDecision.shouldRequest(switchJustTurnedOn = true))
        assertFalse(PetSpeechOverlayPermissionDecision.shouldRequest(switchJustTurnedOn = false))
        assertTrue(
            PetSpeechOverlayPermissionDecision.shouldShowOverlay(
                switchOn = true,
                speaking = true,
                permissionGranted = true
            )
        )
        assertFalse(
            PetSpeechOverlayPermissionDecision.shouldShowOverlay(
                switchOn = true,
                speaking = false,
                permissionGranted = true
            )
        )
        assertFalse(
            PetSpeechOverlayPermissionDecision.shouldShowOverlay(
                switchOn = true,
                speaking = true,
                permissionGranted = false
            )
        )
    }

    @Test
    fun checklistNotificationsDeepLinksToAppNotificationSettings() {
        val targets = PetSpeechChecklistIntentDecision.targets(
            "notifications",
            "com.stably.orca.mobile",
            PetSpeechPlaybackChannel.ID
        )
        assertEquals(
            PetSpeechChecklistIntentDecision.ACTION_APP_NOTIFICATION_SETTINGS,
            targets[0].action
        )
        assertEquals("com.stably.orca.mobile", targets[0].extras[PetSpeechChecklistIntentDecision.EXTRA_APP_PACKAGE])
        assertEquals(
            PetSpeechChecklistIntentDecision.ACTION_APPLICATION_DETAILS_SETTINGS,
            targets[1].action
        )
    }

    @Test
    fun checklistBatteryRequestsIgnoreThenSettings() {
        val targets = PetSpeechChecklistIntentDecision.targets(
            "battery",
            "com.stably.orca.mobile",
            PetSpeechPlaybackChannel.ID
        )
        assertEquals(PetSpeechChecklistIntentDecision.ACTION_REQUEST_IGNORE_BATTERY, targets[0].action)
        assertTrue(targets[0].usePackageUri)
    }

    @Test
    fun mediaHoldPublishesPausePlaybackActions() {
        assertEquals(
            PetSpeechMediaHoldDecision.ACTION_PAUSE or
                PetSpeechMediaHoldDecision.ACTION_PLAY or
                PetSpeechMediaHoldDecision.ACTION_PLAY_PAUSE or
                PetSpeechMediaHoldDecision.ACTION_STOP,
            PetSpeechMediaHoldDecision.playbackActions()
        )
    }

    @Test
    fun mediaPauseAndStopReleaseSessionAndStopTts() {
        val pause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = true,
            speechActive = true
        )
        val stop = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.STOP,
            sessionHeld = true,
            speechActive = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, stop)
        assertEquals(
            "expo.modules.petspeech.ACTION_RELEASE_SESSION",
            PetSpeechMediaCommandDecision.serviceAction(pause)
        )
        assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(pause))
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.PAUSE,
            PetSpeechMediaCommandDecision.releaseReason()
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Aftermath.POST_RESUME_CHIP,
            PetSpeechReleaseAftermathDecision.decide(PetSpeechMediaCommandDecision.releaseReason())
        )
    }

    @Test
    fun pauseAfterOverlayOrKeepWhenNoHostKeepHoldStillReleasesAndStopsTts() {
        assertTrue(
            PetSpeechMediaCommandDecision.keepHoldMatrixDoesNotBlockPause(
                visibilityKeepHold = true,
                keepWhenNoHost = true,
                overlayWhileSpeaking = true
            )
        )
        val matrices = listOf(
            Triple(true, false, true),
            Triple(false, true, true),
            Triple(true, true, true)
        )
        for ((overlay, keepHost, keepHold) in matrices) {
            val pause = PetSpeechMediaCommandDecision.decide(
                PetSpeechMediaCommandDecision.Command.PAUSE,
                sessionHeld = true,
                speechActive = true,
                persistEnabled = true,
                masterEnabled = true,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                visibilityKeepHold = keepHold
            )
            assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
            assertEquals(
                PetSpeechReleaseAftermathDecision.ACTION_RELEASE_SESSION,
                PetSpeechMediaCommandDecision.serviceAction(pause)
            )
            assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(pause))
            assertTrue(PetSpeechMediaCommandDecision.doesNotRestartFgs(pause))
            assertTrue(PetSpeechMediaCommandDecision.persistOffStopDoesNotHold(pause))
            assertTrue(
                PetSpeechMediaCommandDecision.serviceAction(pause) !=
                    PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION
            )
        }
        val persistOffOverlay = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = true,
            speechActive = true,
            persistEnabled = false,
            masterEnabled = true,
            overlayWhileSpeaking = true,
            visibilityKeepHold = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, persistOffOverlay)
        assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(persistOffOverlay))
        assertTrue(PetSpeechMediaCommandDecision.doesNotRestartFgs(persistOffOverlay))
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP,
            PetSpeechMediaCommandDecision.releaseReason(persistEnabled = false)
        )
        val stop = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.STOP,
            sessionHeld = true,
            speechActive = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            visibilityKeepHold = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, stop)
        assertTrue(PetSpeechMediaCommandDecision.doesNotRestartFgs(stop))
        val playPause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY_PAUSE,
            sessionHeld = true,
            speechActive = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            visibilityKeepHold = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, playPause)
        assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(playPause))
        assertTrue(PetSpeechMediaCommandDecision.doesNotRestartFgs(playPause))
    }

    @Test
    fun persistOffPauseAndStopStillStopTtsAndDoNotHold() {
        val pause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = false,
            speechActive = true,
            persistEnabled = false
        )
        val stop = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.STOP,
            sessionHeld = false,
            speechActive = true,
            persistEnabled = false
        )
        val idlePause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = false,
            speechActive = false,
            persistEnabled = false
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, stop)
        assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(pause))
        assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(stop))
        assertEquals(
            PetSpeechReleaseAftermathDecision.ACTION_RELEASE_SESSION,
            PetSpeechMediaCommandDecision.serviceAction(pause)
        )
        assertTrue(PetSpeechMediaCommandDecision.persistOffStopDoesNotHold(pause))
        assertTrue(PetSpeechMediaCommandDecision.persistOffStopDoesNotHold(stop))
        assertTrue(PetSpeechMediaCommandDecision.persistOffStopDoesNotHold(idlePause))
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP,
            PetSpeechMediaCommandDecision.releaseReason(persistEnabled = false)
        )
        val contract = PetSpeechReleaseAftermathDecision.contract(
            PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP
        )
        assertTrue(contract.cancelResumeChip)
        assertFalse(contract.reacquireHold)
        assertFalse(contract.startTts)
        assertEquals(
            PetSpeechReleaseAftermathDecision.ACTION_RELEASE_SESSION,
            contract.serviceAction
        )
        assertTrue(contract.serviceAction != PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION)
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP,
            PetSpeechReleaseAftermathDecision.resolveReason("PAUSE", persistEnabled = false)
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.PAUSE,
            PetSpeechReleaseAftermathDecision.resolveReason("PAUSE", persistEnabled = true)
        )
    }

    @Test
    fun masterOffPauseAndStopStillStopTtsAndDoNotHold() {
        val pause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = false,
            speechActive = true,
            persistEnabled = true,
            masterEnabled = false
        )
        val stop = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.STOP,
            sessionHeld = false,
            speechActive = true,
            persistEnabled = true,
            masterEnabled = false
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, stop)
        assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(pause))
        assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(stop))
        assertTrue(PetSpeechMediaCommandDecision.persistOffStopDoesNotHold(pause))
        assertEquals(
            PetSpeechReleaseAftermathDecision.ACTION_RELEASE_SESSION,
            PetSpeechMediaCommandDecision.serviceAction(pause)
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF,
            PetSpeechMediaCommandDecision.releaseReason(
                persistEnabled = true,
                masterEnabled = false
            )
        )
        val contract = PetSpeechReleaseAftermathDecision.contract(
            PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF
        )
        assertTrue(contract.cancelResumeChip)
        assertTrue(contract.cancelMediaStyle)
        assertFalse(contract.reacquireHold)
        assertFalse(contract.startTts)
        assertFalse(PetSpeechReleaseAftermathDecision.notificationPlan(
            PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF
        ).showResumeChip)
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF,
            PetSpeechReleaseAftermathDecision.resolveReason(
                "PAUSE",
                persistEnabled = true,
                masterEnabled = false
            )
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.PAUSE,
            PetSpeechReleaseAftermathDecision.resolveReason(
                "PAUSE",
                persistEnabled = true,
                masterEnabled = true
            )
        )
    }

    @Test
    fun tabletPlayWhileSpeakingReleasesSessionAndStopsTts() {
        val playWhileSpeaking = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY,
            sessionHeld = true,
            speechActive = true
        )
        val playPauseWhileHeld = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY_PAUSE,
            sessionHeld = true,
            speechActive = false
        )
        assertEquals(
            PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS,
            playWhileSpeaking
        )
        assertEquals(
            PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS,
            playPauseWhileHeld
        )
        assertEquals(
            "expo.modules.petspeech.ACTION_RELEASE_SESSION",
            PetSpeechMediaCommandDecision.serviceAction(playWhileSpeaking)
        )
        assertTrue(PetSpeechMediaCommandDecision.shouldStopTts(playWhileSpeaking))
    }

    @Test
    fun mediaPlayWhenIdleResumesAndUnknownKeyIsIgnored() {
        val resume = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY,
            sessionHeld = false,
            speechActive = false
        )
        val ignoreHeldIdlePlay = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY,
            sessionHeld = true,
            speechActive = false
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RESUME, resume)
        assertEquals(
            PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION,
            PetSpeechMediaCommandDecision.serviceAction(resume)
        )
        assertFalse(PetSpeechMediaCommandDecision.shouldStopTts(resume))
        assertFalse(PetSpeechHoldCommandDecision.shouldStartTts(PetSpeechMediaCommandDecision.serviceAction(resume)))
        assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, ignoreHeldIdlePlay)
        assertEquals(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            PetSpeechMediaCommandDecision.commandFromKeyCode(
                PetSpeechMediaCommandDecision.KEYCODE_MEDIA_PAUSE
            )
        )
        assertEquals(
            PetSpeechMediaCommandDecision.Command.PLAY_PAUSE,
            PetSpeechMediaCommandDecision.commandFromKeyCode(
                PetSpeechMediaCommandDecision.KEYCODE_MEDIA_PLAY_PAUSE
            )
        )
        assertEquals(null, PetSpeechMediaCommandDecision.commandFromKeyCode(0))
    }

    @Test
    fun resumeChipAndMediaPlayAfterPauseReacquireHoldWithoutTts() {
        val sources = listOf(
            PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
            PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
            PetSpeechHoldCommandDecision.Source.JS_HOLD
        )
        for (source in sources) {
            val hold = PetSpeechHoldCommandDecision.decide(source)
            assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, hold.serviceAction)
            assertTrue(hold.reacquireHold)
            assertFalse(hold.startTts)
            assertFalse(PetSpeechHoldCommandDecision.shouldStartTts(hold.serviceAction))
            assertTrue(PetSpeechHoldCommandDecision.isHoldOnlyAction(hold.serviceAction))
        }
        assertTrue(
            PetSpeechHoldCommandDecision.isHoldOnlyAction(
                "expo.modules.petspeech.ACTION_RESUME_FROM_CHIP"
            )
        )
        assertFalse(PetSpeechHoldCommandDecision.shouldStartTts(null))
        assertFalse(
            PetSpeechHoldCommandDecision.isHoldOnlyAction(
                "expo.modules.petspeech.ACTION_RELEASE_SESSION"
            )
        )
    }

    @Test
    fun mediaPlayAfterPauseFiresHoldSessionAndSecondPlayDoesNotSpeak() {
        val afterPause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY,
            sessionHeld = false,
            speechActive = false
        )
        val hold = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RESUME, afterPause)
        assertEquals(hold.serviceAction, PetSpeechMediaCommandDecision.serviceAction(afterPause))
        assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, hold.serviceAction)
        assertTrue(hold.reacquireHold)
        assertFalse(hold.startTts)

        val secondPlay = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY,
            sessionHeld = true,
            speechActive = false
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, secondPlay)
        assertEquals(null, PetSpeechMediaCommandDecision.serviceAction(secondPlay))
        assertFalse(
            PetSpeechHoldCommandDecision.shouldStartTts(
                PetSpeechMediaCommandDecision.serviceAction(secondPlay)
            )
        )
    }

    @Test
    fun resumeChipAndPlayAfterKeepHoldPauseStillHoldWithoutTts() {
        assertTrue(
            PetSpeechHoldCommandDecision.afterKeepHoldPauseDoesNotStartTts(
                keepWhenNoHost = true,
                overlayWhileSpeaking = true,
                afterKeepHoldPause = true
            )
        )
        val pause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = true,
            speechActive = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            visibilityKeepHold = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
        val matrices = listOf(
            Triple(true, false, true),
            Triple(false, true, true),
            Triple(true, true, true)
        )
        for ((overlay, keepHost, afterPause) in matrices) {
            val chip = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            val playHold = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, chip.serviceAction)
            assertTrue(chip.reacquireHold)
            assertFalse(chip.startTts)
            assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, playHold.serviceAction)
            assertTrue(playHold.reacquireHold)
            assertFalse(playHold.startTts)
            val play = PetSpeechMediaCommandDecision.decide(
                PetSpeechMediaCommandDecision.Command.PLAY,
                sessionHeld = false,
                speechActive = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                visibilityKeepHold = false
            )
            assertEquals(PetSpeechMediaCommandDecision.Outcome.RESUME, play)
            assertEquals(
                PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION,
                PetSpeechMediaCommandDecision.serviceAction(play)
            )
            assertFalse(PetSpeechMediaCommandDecision.shouldStopTts(play))
            assertTrue(
                PetSpeechMediaCommandDecision.playAfterKeepHoldPauseResumes(
                    sessionHeld = false,
                    persistEnabled = true,
                    masterEnabled = true
                )
            )
            val secondPlay = PetSpeechMediaCommandDecision.decide(
                PetSpeechMediaCommandDecision.Command.PLAY,
                sessionHeld = true,
                speechActive = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                visibilityKeepHold = true
            )
            assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, secondPlay)
            assertEquals(null, PetSpeechMediaCommandDecision.serviceAction(secondPlay))
            assertTrue(
                PetSpeechMediaCommandDecision.secondPlayWhileHeldIdleIgnores(
                    sessionHeld = true,
                    speechActive = false
                )
            )
            assertFalse(
                PetSpeechHoldCommandDecision.shouldStartTts(
                    PetSpeechMediaCommandDecision.serviceAction(secondPlay)
                )
            )
            val playPause = PetSpeechMediaCommandDecision.decide(
                PetSpeechMediaCommandDecision.Command.PLAY_PAUSE,
                sessionHeld = false,
                speechActive = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                visibilityKeepHold = false
            )
            assertEquals(PetSpeechMediaCommandDecision.Outcome.RESUME, playPause)
            assertEquals(
                PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION,
                PetSpeechMediaCommandDecision.serviceAction(playPause)
            )
            assertFalse(PetSpeechMediaCommandDecision.shouldStopTts(playPause))
        }
    }

    @Test
    fun persistOffResumeChipAndMediaPlayDoNotHoldOrStartTts() {
        val chip = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
            persistEnabled = false
        )
        val mediaPlay = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
            persistEnabled = false
        )
        val jsHold = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.JS_HOLD,
            persistEnabled = false
        )
        assertEquals(null, chip.serviceAction)
        assertFalse(chip.reacquireHold)
        assertFalse(chip.startTts)
        assertEquals(null, mediaPlay.serviceAction)
        assertFalse(mediaPlay.reacquireHold)
        assertFalse(mediaPlay.startTts)
        assertFalse(PetSpeechHoldCommandDecision.shouldStartTts(chip.serviceAction))
        assertFalse(PetSpeechHoldCommandDecision.shouldStartTts(mediaPlay.serviceAction))
        assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, jsHold.serviceAction)
        assertTrue(jsHold.reacquireHold)
        assertFalse(jsHold.startTts)

        val play = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY,
            sessionHeld = false,
            speechActive = false,
            persistEnabled = false
        )
        val playPause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY_PAUSE,
            sessionHeld = false,
            speechActive = false,
            persistEnabled = false
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, play)
        assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, playPause)
        assertEquals(null, PetSpeechMediaCommandDecision.serviceAction(play))
        assertFalse(PetSpeechHoldCommandDecision.shouldStartTts(PetSpeechMediaCommandDecision.serviceAction(play)))
        assertEquals(
            PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
            PetSpeechHoldCommandDecision.parseSource(
                PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION,
                PetSpeechHoldCommandDecision.Source.RESUME_CHIP.name
            )
        )
        assertEquals(
            PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
            PetSpeechHoldCommandDecision.parseSource(
                PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION,
                PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE.name
            )
        )
        assertEquals(
            PetSpeechHoldCommandDecision.Source.JS_HOLD,
            PetSpeechHoldCommandDecision.parseSource(
                PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION,
                null
            )
        )
    }

    @Test
    fun persistOffAndMasterOffPlayAfterKeepHoldPauseStillIgnore() {
        val matrices = listOf(
            Triple(true, false, true),
            Triple(false, true, true),
            Triple(true, true, true)
        )
        for ((overlay, keepHost, afterPause) in matrices) {
            val persistOffChip = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
                persistEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            val persistOffPlayHold = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
                persistEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            assertEquals(null, persistOffChip.serviceAction)
            assertFalse(persistOffChip.reacquireHold)
            assertFalse(persistOffChip.startTts)
            assertEquals(null, persistOffPlayHold.serviceAction)
            assertFalse(persistOffPlayHold.reacquireHold)
            assertFalse(persistOffPlayHold.startTts)

            val persistOffPlay = PetSpeechMediaCommandDecision.decide(
                PetSpeechMediaCommandDecision.Command.PLAY,
                sessionHeld = false,
                speechActive = false,
                persistEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                visibilityKeepHold = false
            )
            val persistOffPlayPause = PetSpeechMediaCommandDecision.decide(
                PetSpeechMediaCommandDecision.Command.PLAY_PAUSE,
                sessionHeld = false,
                speechActive = false,
                persistEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                visibilityKeepHold = false
            )
            assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, persistOffPlay)
            assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, persistOffPlayPause)
            assertEquals(null, PetSpeechMediaCommandDecision.serviceAction(persistOffPlay))
            assertTrue(
                PetSpeechMediaCommandDecision.persistOffPlayAfterKeepHoldPauseIgnores(
                    sessionHeld = false,
                    persistEnabled = false,
                    masterEnabled = true
                )
            )
            assertFalse(
                PetSpeechMediaCommandDecision.playAfterKeepHoldPauseResumes(
                    sessionHeld = false,
                    persistEnabled = false,
                    masterEnabled = true
                )
            )
            assertFalse(
                PetSpeechHoldCommandDecision.shouldStartTts(
                    PetSpeechMediaCommandDecision.serviceAction(persistOffPlay)
                )
            )

            val masterOffChip = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
                persistEnabled = true,
                masterEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            val masterOffPlayHold = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
                persistEnabled = true,
                masterEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            val masterOffPlay = PetSpeechMediaCommandDecision.decide(
                PetSpeechMediaCommandDecision.Command.PLAY,
                sessionHeld = false,
                speechActive = false,
                persistEnabled = true,
                masterEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                visibilityKeepHold = false
            )
            val masterOffPlayPause = PetSpeechMediaCommandDecision.decide(
                PetSpeechMediaCommandDecision.Command.PLAY_PAUSE,
                sessionHeld = false,
                speechActive = false,
                persistEnabled = true,
                masterEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                visibilityKeepHold = false
            )
            assertEquals(null, masterOffChip.serviceAction)
            assertFalse(masterOffChip.reacquireHold)
            assertFalse(masterOffChip.startTts)
            assertEquals(null, masterOffPlayHold.serviceAction)
            assertFalse(masterOffPlayHold.reacquireHold)
            assertFalse(masterOffPlayHold.startTts)
            assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, masterOffPlay)
            assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, masterOffPlayPause)
            assertEquals(null, PetSpeechMediaCommandDecision.serviceAction(masterOffPlay))
            assertTrue(
                PetSpeechMediaCommandDecision.masterOffPlayAfterKeepHoldPauseIgnores(
                    sessionHeld = false,
                    masterEnabled = false
                )
            )

            val jsHold = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.JS_HOLD,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            val persistOffJsHold = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.JS_HOLD,
                persistEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            val masterOffJsHold = PetSpeechHoldCommandDecision.decide(
                PetSpeechHoldCommandDecision.Source.JS_HOLD,
                persistEnabled = true,
                masterEnabled = false,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, jsHold.serviceAction)
            assertTrue(jsHold.reacquireHold)
            assertFalse(jsHold.startTts)
            assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, persistOffJsHold.serviceAction)
            assertTrue(persistOffJsHold.reacquireHold)
            assertFalse(persistOffJsHold.startTts)
            assertEquals(null, masterOffJsHold.serviceAction)
            assertFalse(masterOffJsHold.reacquireHold)
            assertFalse(masterOffJsHold.startTts)
            assertTrue(
                PetSpeechHoldCommandDecision.afterKeepHoldPauseDoesNotStartTts(
                    keepWhenNoHost = keepHost,
                    overlayWhileSpeaking = overlay,
                    afterKeepHoldPause = afterPause
                )
            )
        }
    }

    @Test
    fun persistOffWriteAfterKeepHoldPauseStillCancelsChip() {
        val pause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = true,
            speechActive = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            visibilityKeepHold = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
        assertEquals(
            PetSpeechReleaseAftermathDecision.Aftermath.POST_RESUME_CHIP,
            PetSpeechReleaseAftermathDecision.decide(
                PetSpeechReleaseAftermathDecision.Reason.PAUSE
            )
        )
        assertTrue(
            PetSpeechPersistSettingsWriteDecision.persistOffWriteAfterKeepHoldPauseCancelsChip(
                afterKeepHoldPause = true,
                persistEnabled = false,
                masterEnabled = true
            )
        )
        val persistOff = PetSpeechPersistSettingsWriteDecision.releaseReason(
            persistEnabled = false,
            masterEnabled = true
        )
        val persistOffContract = PetSpeechReleaseAftermathDecision.contract(persistOff!!)
        assertEquals(PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP, persistOff)
        assertTrue(persistOffContract.cancelResumeChip)
        assertTrue(persistOffContract.cancelMediaStyle)
        assertFalse(persistOffContract.reacquireHold)
        assertFalse(persistOffContract.startTts)
        assertFalse(PetSpeechPersistSettingsWriteDecision.mayShowServiceRowAfterWrite(persistOff))
        assertFalse(
            PetSpeechReleaseAftermathDecision.notificationPlan(persistOff).showResumeChip
        )
        assertFalse(
            PetSpeechReleaseAftermathDecision.notificationPlan(persistOff).showServiceRow
        )
        assertFalse(
            PetSpeechReleaseAftermathDecision.notificationPlan(persistOff).showFgs
        )
        assertTrue(
            PetSpeechPersistSettingsWriteDecision.masterOffWriteAfterKeepHoldPauseCancelsChip(
                afterKeepHoldPause = true,
                masterEnabled = false
            )
        )
        val masterOff = PetSpeechPersistSettingsWriteDecision.releaseReason(
            persistEnabled = true,
            masterEnabled = false
        )
        val masterOffContract = PetSpeechReleaseAftermathDecision.contract(masterOff!!)
        assertEquals(PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF, masterOff)
        assertTrue(masterOffContract.cancelResumeChip)
        assertFalse(PetSpeechPersistSettingsWriteDecision.mayShowServiceRowAfterWrite(masterOff))
        assertFalse(
            PetSpeechPersistSettingsWriteDecision.persistOffWriteAfterKeepHoldPauseCancelsChip(
                afterKeepHoldPause = false,
                persistEnabled = false,
                masterEnabled = true
            )
        )
    }

    @Test
    fun bootAfterKeepHoldPauseStillChipOnlyAndHoldWithoutTts() {
        val pause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = true,
            speechActive = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            visibilityKeepHold = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
        val matrices = listOf(
            Triple(true, false, true),
            Triple(false, true, true),
            Triple(true, true, true)
        )
        for ((overlay, keepHost, afterPause) in matrices) {
            val boot = PetSpeechBootResumeDecision.decide(
                persistEnabled = true,
                masterEnabled = true,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            assertTrue(boot.postResumeNotification)
            assertFalse(boot.startForeground)
            assertFalse(boot.startMediaPlaybackForeground)
            assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, boot.tapAction)
            assertFalse(boot.tapStartsTts)
            val persistOffBoot = PetSpeechBootResumeDecision.decide(
                persistEnabled = false,
                masterEnabled = true,
                keepWhenNoHost = keepHost,
                overlayWhileSpeaking = overlay,
                afterKeepHoldPause = afterPause
            )
            assertFalse(persistOffBoot.postResumeNotification)
            assertFalse(persistOffBoot.startForeground)
            assertEquals(null, persistOffBoot.tapAction)
            assertFalse(persistOffBoot.tapStartsTts)
        }
    }

    @Test
    fun visibilityAfterKeepHoldPauseDoesNotReholdOrStartFgs() {
        val pause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = true,
            speechActive = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            visibilityKeepHold = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
        val events = listOf(
            PetSpeechVisibilityHoldDecision.Event.HOME,
            PetSpeechVisibilityHoldDecision.Event.SCREEN_OFF,
            PetSpeechVisibilityHoldDecision.Event.LOCK
        )
        val matrices = listOf(
            Triple(true, false, true),
            Triple(false, true, true),
            Triple(true, true, false)
        )
        for ((overlay, keepHost, persistOn) in matrices) {
            for (event in events) {
                val idle = PetSpeechVisibilityHoldDecision.decide(
                    event,
                    persistEnabled = persistOn,
                    masterEnabled = true,
                    sessionHeld = false,
                    keepWhenNoHost = keepHost,
                    overlayWhileSpeaking = overlay
                )
                assertFalse(idle.keepHold)
                assertFalse(idle.releaseSession)
                assertFalse(idle.startForeground)
                assertFalse(idle.startForegroundFromReceiver)
                assertFalse(idle.startTts)
                val masterOffIdle = PetSpeechVisibilityHoldDecision.decide(
                    event,
                    persistEnabled = persistOn,
                    masterEnabled = false,
                    sessionHeld = false,
                    keepWhenNoHost = keepHost,
                    overlayWhileSpeaking = overlay
                )
                assertFalse(masterOffIdle.keepHold)
                assertFalse(masterOffIdle.releaseSession)
                assertFalse(masterOffIdle.startForeground)
                assertFalse(masterOffIdle.startForegroundFromReceiver)
                assertFalse(PetSpeechVisibilityHoldDecision.keepWhenNoHostNeverStartsForeground(keepHost))
                assertFalse(PetSpeechVisibilityHoldDecision.overlayNeverStartsForeground(overlay))
            }
        }
    }

    @Test
    fun holdHonestyAfterKeepHoldPauseStillRequiresForegroundToMarkHeld() {
        val chip = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            afterKeepHoldPause = true
        )
        val playHold = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            afterKeepHoldPause = true
        )
        assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, chip.serviceAction)
        assertTrue(chip.reacquireHold)
        assertFalse(chip.startTts)
        assertEquals(PetSpeechHoldCommandDecision.ACTION_HOLD_SESSION, playHold.serviceAction)
        assertTrue(playHold.reacquireHold)
        assertFalse(playHold.startTts)
        assertFalse(PetSpeechHoldHonestyDecision.shouldMarkHeld(false))
        assertTrue(PetSpeechHoldHonestyDecision.shouldMarkHeld(true))
        assertFalse(PetSpeechHoldHonestyDecision.shouldKeepHeldOnVisibility(keepHold = false))
    }

    @Test
    fun jsReleaseAfterKeepHoldPauseStillCancelsChip() {
        val pause = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PAUSE,
            sessionHeld = true,
            speechActive = true,
            keepWhenNoHost = true,
            overlayWhileSpeaking = true,
            visibilityKeepHold = true
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.RELEASE_AND_STOP_TTS, pause)
        val js = PetSpeechReleaseAftermathDecision.contract(
            PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE
        )
        assertEquals(PetSpeechReleaseAftermathDecision.Aftermath.CANCEL_ALL, js.aftermath)
        assertTrue(js.cancelResumeChip)
        assertTrue(js.cancelMediaStyle)
        assertFalse(js.reacquireHold)
        assertFalse(js.startTts)
        assertEquals(PetSpeechReleaseAftermathDecision.ACTION_RELEASE_SESSION, js.serviceAction)
        val plan = PetSpeechReleaseAftermathDecision.notificationPlan(
            PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE
        )
        assertFalse(plan.showResumeChip)
        assertFalse(plan.showFgs)
        assertFalse(plan.showServiceRow)
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE,
            PetSpeechReleaseAftermathDecision.parseReason(null)
        )
    }

    @Test
    fun masterOffResumeChipAndMediaPlayDoNotHoldOrStartTts() {
        val chip = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
            persistEnabled = true,
            masterEnabled = false
        )
        val mediaPlay = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE,
            persistEnabled = true,
            masterEnabled = false
        )
        assertEquals(null, chip.serviceAction)
        assertFalse(chip.reacquireHold)
        assertFalse(chip.startTts)
        assertEquals(null, mediaPlay.serviceAction)
        assertFalse(mediaPlay.startTts)
        val play = PetSpeechMediaCommandDecision.decide(
            PetSpeechMediaCommandDecision.Command.PLAY,
            sessionHeld = false,
            speechActive = false,
            persistEnabled = true,
            masterEnabled = false
        )
        assertEquals(PetSpeechMediaCommandDecision.Outcome.IGNORE, play)
        assertEquals(null, PetSpeechMediaCommandDecision.serviceAction(play))
        val jsHold = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.JS_HOLD,
            persistEnabled = true,
            masterEnabled = false
        )
        assertEquals(null, jsHold.serviceAction)
        assertFalse(jsHold.reacquireHold)
        assertFalse(jsHold.startTts)
    }

    @Test
    fun releaseReasonParsesPauseAndDefaultsToJsRelease() {
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.PAUSE,
            PetSpeechReleaseAftermathDecision.parseReason("PAUSE")
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE,
            PetSpeechReleaseAftermathDecision.parseReason(null)
        )
        assertEquals(
            PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE,
            PetSpeechReleaseAftermathDecision.parseReason("not-a-reason")
        )
    }

    @Test
    fun deviceGuardPortalIsNeverAutoRun() {
        assertEquals(
            "com.motorola.deviceguard.portal.activity.PortalActivity",
            PetSpeechOemAutostartDecision.MOTOROLA_PORTAL_ACTIVITY
        )
        assertFalse(
            PetSpeechOemAutostartDecision.isForbiddenAutoRun(
                PetSpeechOemAutostartDecision.MOTOROLA_PORTAL_ACTIVITY
            )
        )
        assertTrue(
            PetSpeechOemAutostartDecision.isForbiddenAutoRun(
                "com.motorola.deviceguard.autorun.AutoRunMainActivity"
            )
        )
    }
}
