package expo.modules.petspeech

object PetSpeechRate {
    const val DEFAULT = 1.2f
    const val MIN = 0.5f
    const val MAX = 2.5f

    // Same steps as grok-desktop-pet 語速: 0.8 / 1.0 / 1.2 / 1.5 / 2.0
    val MENU = floatArrayOf(0.8f, 1.0f, 1.2f, 1.5f, 2.0f)

    fun parse(raw: Any?): Float {
        val n = when (raw) {
            is Number -> raw.toFloat()
            is String -> raw.trim().toFloatOrNull()
            else -> null
        }
        if (n == null || !n.isFinite()) {
            return DEFAULT
        }
        return n.coerceIn(MIN, MAX)
    }

    // Android CJK file playback sounds one 語速 step slower than Mac say.
    fun androidPlaybackSpeed(petRate: Float): Float {
        val parsed = parse(petRate)
        return MENU.firstOrNull { it > parsed + 0.05f } ?: MAX
    }
}
