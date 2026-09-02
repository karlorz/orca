package expo.modules.petspeech

import android.os.Bundle
import android.speech.tts.TextToSpeech

data class PetSpeechCaptionRange(
    val start: Int,
    val end: Int,
    val startMs: Int
)

enum class PetSpeechRangeOrder(val label: String) {
    DOCUMENTED("documented"),
    SWAPPED("swapped")
}

data class PetSpeechInterpretedRanges(
    val ranges: List<PetSpeechCaptionRange>,
    val order: PetSpeechRangeOrder
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

    private fun isValidPair(start: Int, end: Int, textLength: Int): Boolean {
        return start >= 0 && end > start && (textLength <= 0 || end <= textLength)
    }

    fun interpretRangesDetailed(
        raw: List<IntArray>,
        textLength: Int,
        sampleRateHz: Int
    ): PetSpeechInterpretedRanges {
        var documentedValidCount = 0
        var swappedValidCount = 0

        for (triple in raw) {
            if (triple.size < 3) {
                continue
            }
            if (isValidPair(triple[0], triple[1], textLength)) {
                documentedValidCount++
            }
            if (isValidPair(triple[1], triple[2], textLength)) {
                swappedValidCount++
            }
        }

        val order = if (swappedValidCount > documentedValidCount) {
            PetSpeechRangeOrder.SWAPPED
        } else {
            PetSpeechRangeOrder.DOCUMENTED
        }

        val ranges = ArrayList<PetSpeechCaptionRange>()
        for (triple in raw) {
            if (triple.size < 3) {
                continue
            }
            val start: Int
            val end: Int
            val frame: Int
            if (order == PetSpeechRangeOrder.SWAPPED) {
                start = triple[1]
                end = triple[2]
                frame = triple[0]
            } else {
                start = triple[0]
                end = triple[1]
                frame = triple[2]
            }

            if (isValidPair(start, end, textLength)) {
                ranges.add(
                    PetSpeechCaptionRange(
                        start = start,
                        end = end,
                        startMs = startMs(frame, sampleRateHz)
                    )
                )
            }
        }

        return PetSpeechInterpretedRanges(ranges, order)
    }

    fun interpretRanges(
        raw: List<IntArray>,
        textLength: Int,
        sampleRateHz: Int
    ): List<PetSpeechCaptionRange> {
        return interpretRangesDetailed(raw, textLength, sampleRateHz).ranges
    }
}
