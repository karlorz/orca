package expo.modules.petspeech

object PetSpeechStartCommandDecision {
    sealed class Result {
        data class StartForeground(val trimmedText: String) : Result()
        object StopSelf : Result()
    }

    private const val MAX_TEXT_CODE_POINTS = 70

    fun decide(extraText: String?): Result {
        if (extraText == null) {
            return Result.StopSelf
        }
        val trimmed = extraText.trim()
        if (trimmed.isEmpty()) {
            return Result.StopSelf
        }
        if (trimmed.codePointCount(0, trimmed.length) > MAX_TEXT_CODE_POINTS) {
            return Result.StopSelf
        }
        return Result.StartForeground(trimmed)
    }
}
