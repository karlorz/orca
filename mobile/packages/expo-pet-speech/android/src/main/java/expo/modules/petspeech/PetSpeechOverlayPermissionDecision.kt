package expo.modules.petspeech

object PetSpeechOverlayPermissionDecision {
    fun mayStartOrHoldForeground(): Boolean = false

    fun shouldRequest(switchJustTurnedOn: Boolean): Boolean = switchJustTurnedOn

    fun shouldShowOverlay(
        switchOn: Boolean,
        speaking: Boolean,
        permissionGranted: Boolean
    ): Boolean = switchOn && speaking && permissionGranted
}
