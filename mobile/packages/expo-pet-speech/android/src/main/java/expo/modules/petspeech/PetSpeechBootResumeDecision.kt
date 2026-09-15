package expo.modules.petspeech

object PetSpeechBootResumeDecision {
    const val ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED"
    const val ACTION_LOCKED_BOOT_COMPLETED = "android.intent.action.LOCKED_BOOT_COMPLETED"
    const val MEDIA_PLAYBACK_FOREGROUND_TYPE = "mediaPlayback"

    data class Result(
        val postResumeNotification: Boolean,
        val startForeground: Boolean,
        val startMediaPlaybackForeground: Boolean,
        val tapAction: String?,
        val tapStartsTts: Boolean
    )

    fun isBootAction(action: String?): Boolean {
        return action == ACTION_BOOT_COMPLETED || action == ACTION_LOCKED_BOOT_COMPLETED
    }

    fun declaredBootActions(): List<String> {
        return listOf(ACTION_BOOT_COMPLETED, ACTION_LOCKED_BOOT_COMPLETED)
    }

    fun mayStartMediaPlaybackFromReceiver(): Boolean {
        return false
    }

    fun receiverMayStartForeground(keepWhenNoHost: Boolean): Boolean {
        return false
    }

    fun decide(
        persistEnabled: Boolean,
        masterEnabled: Boolean,
        keepWhenNoHost: Boolean = false,
        overlayWhileSpeaking: Boolean = false,
        afterKeepHoldPause: Boolean = false
    ): Result {
        val hold = PetSpeechHoldCommandDecision.decide(
            PetSpeechHoldCommandDecision.Source.RESUME_CHIP,
            persistEnabled = persistEnabled && masterEnabled,
            keepWhenNoHost = keepWhenNoHost,
            overlayWhileSpeaking = overlayWhileSpeaking,
            afterKeepHoldPause = afterKeepHoldPause
        )
        val startFgs = receiverMayStartForeground(keepWhenNoHost) ||
            (overlayWhileSpeaking && PetSpeechOverlayPermissionDecision.mayStartOrHoldForeground())
        return Result(
            postResumeNotification = persistEnabled && masterEnabled,
            startForeground = startFgs,
            startMediaPlaybackForeground = startFgs,
            tapAction = hold.serviceAction,
            tapStartsTts = hold.startTts
        )
    }

    fun notificationPlan(persistEnabled: Boolean, masterEnabled: Boolean): PetSpeechNotificationSetDecision.Plan {
        return if (decide(persistEnabled, masterEnabled).postResumeNotification) {
            PetSpeechNotificationSetDecision.afterPause()
        } else {
            PetSpeechNotificationSetDecision.afterMasterOff()
        }
    }
}
