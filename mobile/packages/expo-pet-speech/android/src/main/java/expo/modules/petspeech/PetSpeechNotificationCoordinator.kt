package expo.modules.petspeech

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

object PetSpeechNotificationCoordinator {
    const val STATUS_CHANNEL_ID = "orca_pet_speech_status"
    const val STATUS_CHANNEL_NAME = "Pet voice service"
    const val RESUME_CHANNEL_ID = "orca_pet_speech_resume"
    const val RESUME_CHANNEL_NAME = "Pet voice resume"
    const val SERVICE_ROW_TITLE = "Pet voice service on"
    const val SERVICE_ROW_TEXT = "寵物語音服務已開啟"
    const val RESUME_TITLE = "Pet voice paused"
    const val RESUME_TEXT = "Tap to resume"
    const val BOOT_RESUME_TITLE = "Resume Pet voice"
    const val BOOT_RESUME_TEXT = "Tap to restart pet voice"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                STATUS_CHANNEL_ID,
                STATUS_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Headuck-style pet voice service status"
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
        )
        manager.createNotificationChannel(
            NotificationChannel(
                RESUME_CHANNEL_ID,
                RESUME_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Tap to resume pet voice after pause or reboot"
                setShowBadge(false)
            }
        )
    }

    fun applyPlan(
        context: Context,
        plan: PetSpeechNotificationSetDecision.Plan,
        resumeTitle: String = RESUME_TITLE,
        resumeText: String = RESUME_TEXT
    ) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return

        applyServiceRow(context, plan.showServiceRow)

        if (plan.showResumeChip) {
            manager.notify(
                PetSpeechNotificationSetDecision.RESUME_CHIP_NOTIFICATION_ID,
                buildResumeChip(context, resumeTitle, resumeText)
            )
        } else {
            manager.cancel(PetSpeechNotificationSetDecision.RESUME_CHIP_NOTIFICATION_ID)
        }

        if (!plan.showFgs) {
            manager.cancel(PetSpeechNotificationSetDecision.FGS_NOTIFICATION_ID)
        }
    }

    fun applyServiceRow(context: Context, show: Boolean) {
        ensureChannels(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return
        if (show) {
            manager.notify(
                PetSpeechNotificationSetDecision.SERVICE_ROW_NOTIFICATION_ID,
                buildServiceRow(context)
            )
        } else {
            manager.cancel(PetSpeechNotificationSetDecision.SERVICE_ROW_NOTIFICATION_ID)
        }
    }

    fun cancelAll(context: Context) {
        applyPlan(context, PetSpeechNotificationSetDecision.afterMasterOff())
    }

    private fun buildServiceRow(context: Context): android.app.Notification {
        val stopIntent = PendingIntent.getService(
            context,
            11,
            Intent(context, PetSpeechForegroundService::class.java).apply {
                action = PetSpeechForegroundService.ACTION_PAUSE_PERSIST
            },
            pendingFlags()
        )
        return NotificationCompat.Builder(context, STATUS_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(SERVICE_ROW_TITLE)
            .setContentText(SERVICE_ROW_TEXT)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .addAction(0, "Stop", stopIntent)
            .build()
    }

    private fun buildResumeChip(
        context: Context,
        title: String,
        text: String
    ): android.app.Notification {
        val resumeIntent = PendingIntent.getService(
            context,
            12,
            Intent(context, PetSpeechForegroundService::class.java).apply {
                action = PetSpeechForegroundService.ACTION_RESUME_FROM_CHIP
            },
            pendingFlags()
        )
        return NotificationCompat.Builder(context, RESUME_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(resumeIntent)
            .setAutoCancel(true)
            .setOngoing(false)
            .build()
    }

    fun pendingFlags(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
    }
}
