package expo.modules.petspeech

object PetSpeechForegroundObligation {
    fun refusedHoldMustPromoteThenStop(
        allowsHold: Boolean,
        hold: PetSpeechHoldCommandDecision.Result
    ): Boolean {
        return !allowsHold || hold.serviceAction == null || !hold.reacquireHold || hold.startTts
    }

    fun shouldStartHoldForegroundService(
        persist: PetSpeechPersistPrefs.Snapshot,
        source: PetSpeechHoldCommandDecision.Source
    ): Boolean {
        val allowsHold = PetSpeechPauseLatchDecision.allowsHold(persist.pauseLatched, source)
        val hold = PetSpeechHoldCommandDecision.decide(
            source,
            persistEnabled = persist.persistEnabled,
            masterEnabled = persist.masterEnabled,
            keepWhenNoHost = persist.keepWhenNoHost,
            overlayWhileSpeaking = persist.overlayWhileSpeaking
        )
        return !refusedHoldMustPromoteThenStop(allowsHold, hold)
    }
}
