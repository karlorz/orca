package expo.modules.petspeech

object PetSpeechMediaHoldDecision {
    const val ACTION_STOP: Long = 1L shl 0
    const val ACTION_PAUSE: Long = 1L shl 1
    const val ACTION_PLAY: Long = 1L shl 2
    const val ACTION_PLAY_PAUSE: Long = 1L shl 9

    fun playbackActions(): Long {
        return ACTION_STOP or ACTION_PAUSE or ACTION_PLAY or ACTION_PLAY_PAUSE
    }
}
