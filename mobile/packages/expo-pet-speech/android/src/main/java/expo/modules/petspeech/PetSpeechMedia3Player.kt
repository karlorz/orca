package expo.modules.petspeech

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import java.io.File

class PetSpeechMedia3Player : PetSpeechAudioPlayer {

    override val implementationName: String = PetSpeechPlayerKind.MEDIA3.identifier

    private var exoPlayer: ExoPlayer? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    override fun play(
        context: Context,
        filePath: String,
        rate: Float,
        debug: Boolean,
        onComplete: () -> Unit,
        onError: (String) -> Unit
    ) {
        val runPlay = {
            try {
                stopAndRelease()

                // Configure renderers factory with software audio processing (Sonic)
                // and explicitly disable hardware AudioTrack playback-parameter delegation and offload
                val renderersFactory = object : DefaultRenderersFactory(context) {
                    override fun buildAudioSink(
                        context: Context,
                        enableFloatOutput: Boolean,
                        enableAudioTrackPlaybackParams: Boolean
                    ): AudioSink? {
                        val sonic = SonicAudioProcessor()
                        return DefaultAudioSink.Builder(context)
                            .setAudioProcessors(arrayOf(sonic))
                            .setEnableAudioTrackPlaybackParams(false)
                            .setOffloadMode(DefaultAudioSink.OFFLOAD_MODE_DISABLED)
                            .setEnableFloatOutput(false)
                            .build()
                    }
                }

                val audioAttributes = AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .build()

                val player = ExoPlayer.Builder(context, renderersFactory)
                    .setAudioAttributes(audioAttributes, false) // Audio focus handled by FGS
                    .build()

                exoPlayer = player

                // Set playback speed with pitch preserved (pitch = 1.0f)
                player.playbackParameters = PlaybackParameters(rate, 1.0f)

                player.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        when (playbackState) {
                            Player.STATE_ENDED -> {
                                onComplete()
                            }
                            Player.STATE_READY -> {
                                if (debug) {
                                    try {
                                        val durationMs = player.duration
                                        android.util.Log.i(
                                            "PetSpeechDebug",
                                            "PetSpeechMedia3Player ready filePath=$filePath durationMs=$durationMs rate=$rate"
                                        )
                                    } catch (_: Exception) {}
                                }
                            }
                            else -> {}
                        }
                    }

                    override fun onPlayerError(error: PlaybackException) {
                        onError("Media3 error code=${error.errorCode} message=${error.message}")
                    }
                })

                val mediaItem = MediaItem.fromUri(Uri.fromFile(File(filePath)))
                player.setMediaItem(mediaItem)
                player.prepare()
                player.playWhenReady = true
            } catch (e: Exception) {
                onError(e.message ?: "Media3 player prepare/play failed")
            }
        }

        runOnMain(runPlay)
    }

    override fun setVolume(volume: Float) {
        runOnMain {
            try {
                exoPlayer?.volume = volume
            } catch (_: Exception) {}
        }
    }

    override fun stopAndRelease() {
        runOnMain {
            try {
                exoPlayer?.release()
            } catch (_: Exception) {}
            exoPlayer = null
        }
    }

    private fun runOnMain(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action()
        } else {
            mainHandler.post(action)
        }
    }
}
