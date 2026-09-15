package expo.modules.petspeech

object PetSpeechPersistSettingsWriteDecision {
    fun releaseReason(
        persistEnabled: Boolean?,
        masterEnabled: Boolean?
    ): PetSpeechReleaseAftermathDecision.Reason? {
        return when {
            masterEnabled == false -> PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF
            persistEnabled == false -> PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP
            else -> null
        }
    }

    fun shouldStartTts(reason: PetSpeechReleaseAftermathDecision.Reason?): Boolean {
        if (reason == null) {
            return false
        }
        return PetSpeechReleaseAftermathDecision.contract(reason).startTts
    }

    fun shouldReacquireHold(reason: PetSpeechReleaseAftermathDecision.Reason?): Boolean {
        if (reason == null) {
            return false
        }
        return PetSpeechReleaseAftermathDecision.contract(reason).reacquireHold
    }

    fun mayShowServiceRowAfterWrite(reason: PetSpeechReleaseAftermathDecision.Reason?): Boolean {
        return reason == null
    }

    fun persistOffWriteAfterKeepHoldPauseCancelsChip(
        afterKeepHoldPause: Boolean,
        persistEnabled: Boolean,
        masterEnabled: Boolean
    ): Boolean {
        if (!afterKeepHoldPause || persistEnabled || !masterEnabled) {
            return false
        }
        val reason = releaseReason(persistEnabled = false, masterEnabled = true)
        return reason == PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP &&
            !mayShowServiceRowAfterWrite(reason) &&
            !shouldStartTts(reason) &&
            !shouldReacquireHold(reason)
    }

    fun masterOffWriteAfterKeepHoldPauseCancelsChip(
        afterKeepHoldPause: Boolean,
        masterEnabled: Boolean
    ): Boolean {
        if (!afterKeepHoldPause || masterEnabled) {
            return false
        }
        val reason = releaseReason(persistEnabled = true, masterEnabled = false)
        return reason == PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF &&
            !mayShowServiceRowAfterWrite(reason) &&
            !shouldStartTts(reason) &&
            !shouldReacquireHold(reason)
    }
}
