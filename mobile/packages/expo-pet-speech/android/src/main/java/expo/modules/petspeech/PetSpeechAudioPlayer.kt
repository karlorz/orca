package expo.modules.petspeech

import android.content.Context

interface PetSpeechAudioPlayer {
    val implementationName: String
    fun play(
        context: Context,
        filePath: String,
        rate: Float,
        debug: Boolean,
        onComplete: () -> Unit,
        onError: (String) -> Unit
    )
    fun setVolume(volume: Float)
    fun stopAndRelease()
}
