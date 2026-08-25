package expo.modules.petspeech

object PetSpeechRate {
    const val DEFAULT = 1.2f
    const val MIN = 0.5f
    const val MAX = 2.5f

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
}
