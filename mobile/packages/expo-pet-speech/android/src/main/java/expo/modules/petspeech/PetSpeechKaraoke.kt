package expo.modules.petspeech

data class PetSpeechCaptionRange(
    val start: Int,
    val end: Int,
    val startMs: Int
)

object PetSpeechKaraoke {
    fun startMs(frame: Int, sampleRateHz: Int): Int {
        if (sampleRateHz <= 0 || frame <= 0) {
            return 0
        }
        return ((frame.toLong() * 1000L) / sampleRateHz.toLong()).toInt()
    }

    fun wallDelayMs(startMs: Int, rate: Float): Long {
        val speed = if (rate > 0f) rate else 1f
        return (startMs.toFloat() / speed).toLong().coerceAtLeast(0L)
    }
}
