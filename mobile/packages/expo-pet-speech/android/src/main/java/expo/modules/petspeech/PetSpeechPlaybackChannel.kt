package expo.modules.petspeech

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

object PetSpeechPlaybackChannel {
    const val ID = "orca_pet_speech_media"
    const val NAME = "Pet voice player"
    const val LEGACY_ID = "orca_pet_speech_playback"

    fun ensure(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return
        manager.deleteNotificationChannel(LEGACY_ID)
        manager.createNotificationChannel(
            NotificationChannel(
                ID,
                NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Lock-screen MediaStyle player for pet voice"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
        )
    }
}
