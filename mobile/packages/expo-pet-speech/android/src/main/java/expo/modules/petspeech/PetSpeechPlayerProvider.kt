package expo.modules.petspeech

object PetSpeechPlayerProvider {
    // Default to MEDIA_PLAYER until the iPlay40 device gate passes
    var defaultPlayerKind: PetSpeechPlayerKind = PetSpeechPlayerKind.MEDIA_PLAYER

    // Allow mock/custom player factory injection for testing without device/Android framework dependencies
    var playerFactory: ((PetSpeechPlayerKind) -> PetSpeechAudioPlayer)? = null

    fun createPlayer(playerKind: PetSpeechPlayerKind = defaultPlayerKind): PetSpeechAudioPlayer {
        val customFactory = playerFactory
        if (customFactory != null) {
            return customFactory(playerKind)
        }
        return when (playerKind) {
            PetSpeechPlayerKind.MEDIA3 -> PetSpeechMedia3Player()
            PetSpeechPlayerKind.MEDIA_PLAYER -> PetSpeechMediaPlayer()
        }
    }

    fun reset() {
        defaultPlayerKind = PetSpeechPlayerKind.MEDIA_PLAYER
        playerFactory = null
    }
}
