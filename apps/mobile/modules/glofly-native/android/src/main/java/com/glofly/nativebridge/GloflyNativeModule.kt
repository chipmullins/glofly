package com.glofly.nativebridge

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Glofly's own Android code, reached from JavaScript as `GloflyNative`:
 * voice-message recording (Opus), and later push notifications and call ringing.
 */
class GloflyNativeModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "No React context" }

  private var voice: VoiceRecorder? = null
  private fun recorder(): VoiceRecorder = voice ?: VoiceRecorder(context.applicationContext).also { voice = it }

  override fun definition() = ModuleDefinition {
    Name("GloflyNative")

    Function("notificationsEnabled") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }
    Function("openNotificationSettings") {
      openSettings(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
    }
    Function("canUseFullScreenIntent") {
      if (Build.VERSION.SDK_INT >= 34) {
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).canUseFullScreenIntent()
      } else {
        true
      }
    }
    Function("openFullScreenIntentSettings") {
      if (Build.VERSION.SDK_INT >= 34) {
        openSettings(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}")))
      } else {
        openSettings(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
      }
    }

    AsyncFunction("startVoice") {
      recorder().start()
    }
    Function("voiceLevel") {
      voice?.level() ?: 0.0
    }
    AsyncFunction("stopVoice") {
      voice?.stop()
    }
    Function("cancelVoice") {
      voice?.cancel()
    }

    OnDestroy {
      voice?.cancel()
    }
  }

  private fun openSettings(intent: Intent): Boolean =
    try {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (_: Exception) {
      false
    }
}
