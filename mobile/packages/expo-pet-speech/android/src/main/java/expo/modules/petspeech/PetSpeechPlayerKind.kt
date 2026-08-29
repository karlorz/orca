package expo.modules.petspeech

enum class PetSpeechPlayerKind(val identifier: String) {
    MEDIA_PLAYER("mediaplayer"),
    MEDIA3("media3");

    companion object {
        fun fromIdentifier(raw: String?): PetSpeechPlayerKind {
            return when (raw?.trim()?.lowercase()) {
                "media3", "exoplayer" -> MEDIA3
                else -> MEDIA_PLAYER
            }
        }
    }
}
