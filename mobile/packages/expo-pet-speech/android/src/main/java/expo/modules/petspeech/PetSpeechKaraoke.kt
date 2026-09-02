package expo.modules.petspeech

import android.os.Bundle
import android.speech.tts.TextToSpeech

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

    fun acceptsCallbackId(id: String?, utteranceId: String): Boolean {
        return id == null || id == utteranceId
    }

    fun utteranceParams(
        utteranceId: String,
        onPut: ((key: String, value: String) -> Unit)? = null
    ): Bundle {
        onPut?.invoke(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
        return Bundle().apply {
            putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
        }
    }
}
