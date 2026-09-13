package expo.modules.petspeech

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri

object PetSpeechChecklistOpener {
    fun open(context: Context, item: String): Boolean {
        val app = context.applicationContext
        if (item == "notifications" || item == "lock-channel") {
            PetSpeechPlaybackChannel.ensure(app)
            PetSpeechNotificationCoordinator.ensureChannels(app)
        }
        val targets = PetSpeechChecklistIntentDecision.targets(
            item,
            app.packageName,
            PetSpeechPlaybackChannel.ID
        )
        for (target in targets) {
            val intent = Intent(target.action)
            if (target.componentPackage != null && target.componentClass != null) {
                intent.component = ComponentName(target.componentPackage, target.componentClass)
            }
            if (target.usePackageUri) {
                intent.data = Uri.parse("package:${app.packageName}")
            }
            for ((key, value) in target.extras) {
                intent.putExtra(key, value)
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return true
            } catch (_: Exception) {
            }
        }
        return false
    }
}
