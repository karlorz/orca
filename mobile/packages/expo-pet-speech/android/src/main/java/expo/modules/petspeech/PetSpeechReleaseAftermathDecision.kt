package expo.modules.petspeech

object PetSpeechReleaseAftermathDecision {
    const val ACTION_RELEASE_SESSION = "expo.modules.petspeech.ACTION_RELEASE_SESSION"

    enum class Reason {
        PAUSE,
        MASTER_OFF,
        JS_RELEASE,
        PERSIST_OFF_STOP
    }

    enum class Aftermath {
        POST_RESUME_CHIP,
        CANCEL_ALL
    }

    data class Contract(
        val aftermath: Aftermath,
        val cancelResumeChip: Boolean,
        val cancelMediaStyle: Boolean,
        val serviceAction: String,
        val reacquireHold: Boolean,
        val startTts: Boolean
    )

    fun decide(reason: Reason): Aftermath {
        return contract(reason).aftermath
    }

    fun contract(reason: Reason): Contract {
        return when (reason) {
            Reason.PAUSE -> Contract(
                aftermath = Aftermath.POST_RESUME_CHIP,
                cancelResumeChip = false,
                cancelMediaStyle = true,
                serviceAction = ACTION_RELEASE_SESSION,
                reacquireHold = false,
                startTts = false
            )
            Reason.MASTER_OFF, Reason.JS_RELEASE, Reason.PERSIST_OFF_STOP -> Contract(
                aftermath = Aftermath.CANCEL_ALL,
                cancelResumeChip = true,
                cancelMediaStyle = true,
                serviceAction = ACTION_RELEASE_SESSION,
                reacquireHold = false,
                startTts = false
            )
        }
    }

    fun notificationPlan(reason: Reason): PetSpeechNotificationSetDecision.Plan {
        return when (contract(reason).aftermath) {
            Aftermath.POST_RESUME_CHIP -> PetSpeechNotificationSetDecision.afterPause()
            Aftermath.CANCEL_ALL -> PetSpeechNotificationSetDecision.afterMasterOff()
        }
    }

    fun parseReason(raw: String?): Reason {
        if (raw.isNullOrEmpty()) {
            return Reason.JS_RELEASE
        }
        return try {
            Reason.valueOf(raw)
        } catch (_: IllegalArgumentException) {
            Reason.JS_RELEASE
        }
    }

    fun resolveReason(
        raw: String?,
        persistEnabled: Boolean,
        masterEnabled: Boolean = true
    ): Reason {
        if (!masterEnabled) {
            return Reason.MASTER_OFF
        }
        val parsed = parseReason(raw)
        if (parsed == Reason.PAUSE && !persistEnabled) {
            return Reason.PERSIST_OFF_STOP
        }
        return parsed
    }
}
