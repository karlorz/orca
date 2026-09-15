package expo.modules.petspeech

object PetSpeechHoldHonestyDecision {
    fun shouldMarkHeld(startForegroundSucceeded: Boolean): Boolean = startForegroundSucceeded

    fun shouldKeepHeldOnVisibility(keepHold: Boolean): Boolean = keepHold
}
