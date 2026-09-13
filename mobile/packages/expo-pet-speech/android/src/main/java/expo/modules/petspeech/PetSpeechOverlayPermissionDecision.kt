package expo.modules.petspeech

object PetSpeechOverlayPermissionDecision {
    fun shouldRequest(switchJustTurnedOn: Boolean): Boolean = switchJustTurnedOn

    fun shouldShowOverlay(
        switchOn: Boolean,
        speaking: Boolean,
        permissionGranted: Boolean
    ): Boolean = switchOn && speaking && permissionGranted
}
