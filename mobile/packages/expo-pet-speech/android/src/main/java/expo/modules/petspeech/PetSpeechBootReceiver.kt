package expo.modules.petspeech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class PetSpeechBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (context == null) {
            return
        }
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED &&
            intent?.action != Intent.ACTION_LOCKED_BOOT_COMPLETED
        ) {
            return
        }
        val prefs = PetSpeechPersistPrefs.read(context)
        val decision = PetSpeechBootResumeDecision.decide(
            persistEnabled = prefs.persistEnabled,
            masterEnabled = prefs.masterEnabled
        )
        if (decision.startForeground) {
            return
        }
        if (decision.postResumeNotification) {
            PetSpeechNotificationCoordinator.applyPlan(
                context,
                PetSpeechNotificationSetDecision.afterPause(),
                resumeTitle = PetSpeechNotificationCoordinator.BOOT_RESUME_TITLE,
                resumeText = PetSpeechNotificationCoordinator.BOOT_RESUME_TEXT
            )
        }
    }
}
