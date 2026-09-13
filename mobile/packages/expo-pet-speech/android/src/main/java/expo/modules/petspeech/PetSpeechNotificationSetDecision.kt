package expo.modules.petspeech

object PetSpeechNotificationSetDecision {
    const val FGS_NOTIFICATION_ID = 4040
    const val SERVICE_ROW_NOTIFICATION_ID = 4041
    const val RESUME_CHIP_NOTIFICATION_ID = 4042

    data class Plan(
        val showFgs: Boolean,
        val showServiceRow: Boolean,
        val showResumeChip: Boolean
    )

    fun whileHeld(showServiceRow: Boolean): Plan {
        return Plan(
            showFgs = true,
            showServiceRow = showServiceRow,
            showResumeChip = false
        )
    }

    fun afterPause(): Plan {
        return Plan(showFgs = false, showServiceRow = false, showResumeChip = true)
    }

    fun afterMasterOff(): Plan {
        return Plan(showFgs = false, showServiceRow = false, showResumeChip = false)
    }
}
