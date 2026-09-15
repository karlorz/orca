package expo.modules.petspeech

object PetSpeechPauseLatchDecision {
    fun shouldLatch(reason: PetSpeechReleaseAftermathDecision.Reason): Boolean {
        return reason == PetSpeechReleaseAftermathDecision.Reason.PAUSE
    }

    fun shouldClearOnRelease(reason: PetSpeechReleaseAftermathDecision.Reason): Boolean {
        return reason == PetSpeechReleaseAftermathDecision.Reason.MASTER_OFF ||
            reason == PetSpeechReleaseAftermathDecision.Reason.JS_RELEASE ||
            reason == PetSpeechReleaseAftermathDecision.Reason.PERSIST_OFF_STOP
    }

    fun shouldClearOnHold(source: PetSpeechHoldCommandDecision.Source): Boolean {
        return source == PetSpeechHoldCommandDecision.Source.RESUME_CHIP ||
            source == PetSpeechHoldCommandDecision.Source.MEDIA_PLAY_AFTER_PAUSE
    }

    fun refusesSpeak(latched: Boolean): Boolean = latched

    fun allowsHold(
        latched: Boolean,
        source: PetSpeechHoldCommandDecision.Source
    ): Boolean {
        if (!latched) {
            return true
        }
        return shouldClearOnHold(source)
    }
}
