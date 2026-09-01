package expo.modules.petspeech

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.PlaybackParams
import android.os.Build

class PetSpeechMediaPlayer : PetSpeechAudioPlayer {

    override val implementationName: String = PetSpeechPlayerKind.MEDIA_PLAYER.identifier

    private var mediaPlayer: MediaPlayer? = null

    override fun play(
        context: Context,
        filePath: String,
        rate: Float,
        debug: Boolean,
        onComplete: () -> Unit,
        onError: (String) -> Unit,
        onStarted: () -> Unit
    ) {
        try {
            stopAndRelease()
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                setDataSource(filePath)
                setOnCompletionListener {
                    onComplete()
                }
                setOnErrorListener { _, what, extra ->
                    onError("MediaPlayer error what=$what extra=$extra")
                    true
                }
                prepare()
                if (debug) {
                    try {
                        val durationMs = duration
                        android.util.Log.i("PetSpeechDebug", "PetSpeechMediaPlayer prepared filePath=$filePath durationMs=$durationMs rate=$rate")
                    } catch (_: Exception) {}
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    try {
                        playbackParams = PlaybackParams()
                            .setSpeed(rate)
                            .setPitch(1.0f)
                    } catch (_: Exception) {}
                }
                start()
                onStarted()
            }
        } catch (e: Exception) {
            onError(e.message ?: "MediaPlayer prepare/start failed")
        }
    }

    override fun setVolume(volume: Float) {
        try {
            mediaPlayer?.setVolume(volume, volume)
        } catch (_: Exception) {}
    }

    override fun stopAndRelease() {
        try {
            mediaPlayer?.reset()
        } catch (_: Exception) {}
        try {
            mediaPlayer?.stop()
        } catch (_: Exception) {}
        try {
            mediaPlayer?.release()
        } catch (_: Exception) {}
        mediaPlayer = null
    }
}
