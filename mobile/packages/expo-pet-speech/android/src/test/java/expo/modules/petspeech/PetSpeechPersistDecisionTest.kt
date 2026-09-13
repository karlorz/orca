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
    fun notificationPlanAfterMasterOffShowsNothing() {
        val plan = PetSpeechNotificationSetDecision.afterMasterOff()
        assertFalse(plan.showFgs)
        assertFalse(plan.showServiceRow)
        assertFalse(plan.showResumeChip)
    }

    @Test
    fun bootNeverStartsForegroundAndPostsResumeOnlyWhenPersistAndMasterOn() {
        val on = PetSpeechBootResumeDecision.decide(persistEnabled = true, masterEnabled = true)
        assertTrue(on.postResumeNotification)
        assertFalse(on.startForeground)

        val persistOff = PetSpeechBootResumeDecision.decide(persistEnabled = false, masterEnabled = true)
        assertFalse(persistOff.postResumeNotification)
        assertFalse(persistOff.startForeground)

        val masterOff = PetSpeechBootResumeDecision.decide(persistEnabled = true, masterEnabled = false)
        assertFalse(masterOff.postResumeNotification)
        assertFalse(masterOff.startForeground)
    }

    @Test
    fun overlayRequestsPermissionOnlyWhenSwitchTurnsOnAndShowsOnlyWhileSpeaking() {
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
