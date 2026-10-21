package com.glofly.nativebridge

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * Glofly's own Android code, reached from JavaScript as `GloflyNative`: push notifications
 * (Firebase token, chat / call notifications, Reply and Decline from the notification), the
 * "Call in progress" service, ringing over the lock screen, and voice-message recording (Opus).
 */
class GloflyNativeModule : Module() {
  companion object {
    private var instance: WeakReference<GloflyNativeModule>? = null

    /** From the messaging service and notification buttons, when the JavaScript side is running. */
    fun emitEvent(name: String, body: Map<String, Any?>) {
      try {
        instance?.get()?.sendEvent(name, body)
      } catch (_: Exception) {
      }
    }

    fun emitToken(token: String) = emitEvent("pushToken", mapOf("token" to token))
  }

  private val context
    get() = requireNotNull(appContext.reactContext) { "No React context" }

  private var voice: VoiceRecorder? = null
  private fun recorder(): VoiceRecorder = voice ?: VoiceRecorder(context.applicationContext).also { voice = it }

  override fun definition() = ModuleDefinition {
    Name("GloflyNative")
    Events("pushToken", "callRing", "hangUp", "pipChanged", "share", "keyCommand")

    OnCreate {
      instance = WeakReference(this@GloflyNativeModule)
      try {
        Notifier.ensureChannels(context.applicationContext)
      } catch (_: Exception) {
      }
    }

    // ---- Push notifications ----

    AsyncFunction("getPushToken") { promise: Promise ->
      val ctx = context.applicationContext
      if (FirebaseApp.getApps(ctx).isEmpty()) {
        // Built without Firebase settings (google-services.json): no push on this build.
        promise.resolve(null)
        return@AsyncFunction
      }
      FirebaseMessaging.getInstance().token
        .addOnSuccessListener { token ->
          PushStore.saveFcmToken(ctx, token)
          promise.resolve(token)
        }
        .addOnFailureListener { promise.resolve(PushStore.fcmToken(ctx)) }
    }

    Function("configurePush") { c: Map<String, Any?> ->
      PushStore.saveConfig(
        context.applicationContext,
        PushStore.Config(
          serverUrl = c["serverUrl"] as? String ?: return@Function,
          token = c["token"] as? String ?: return@Function,
          version = c["version"] as? String ?: "1.0.0",
          platform = c["platform"] as? String ?: "android",
          meId = c["meId"] as? String ?: "",
          meName = c["meName"] as? String ?: "You",
          meAvatar = c["meAvatar"] as? String,
          vibrate = c["vibrate"] as? Boolean ?: true,
        ),
      )
    }

    /** Signed out: forget the session and remove every Glofly notification. */
    Function("clearPush") {
      val ctx = context.applicationContext
      PushStore.clear(ctx)
      Notifier.cancelAll(ctx)
      OngoingCallService.stop(ctx)
    }

    Function("cancelChatNotification") { conversationId: String ->
      Notifier.cancelChat(context.applicationContext, conversationId)
    }

    Function("cancelCallNotification") { callId: String ->
      Notifier.cancelCall(context.applicationContext, callId)
    }

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

    // ---- Calls ----

    /** While the incoming call screen shows: over the lock screen, screen on. */
    Function("showOverLockScreen") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
          activity.setShowWhenLocked(on)
          activity.setTurnScreenOn(on)
        } else {
          @Suppress("DEPRECATION")
          val flags = WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
          if (on) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
        }
      }
    }

    /** Keeps the screen on during video calls. */
    Function("keepScreenOn") { on: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      activity.runOnUiThread {
        if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    Function("startOngoingCall") { callId: String, conversationId: String, title: String, video: Boolean ->
      OngoingCallService.start(context.applicationContext, callId, conversationId, title, video)
    }

    Function("stopOngoingCall") {
      OngoingCallService.stop(context.applicationContext)
    }

    // ---- Sounds picked in Settings (res/raw names): notification channels follow them ----

    Function("setSounds") { message: String, ringtone: String ->
      Notifier.setSounds(context.applicationContext, message, ringtone)
    }

    // ---- Picture-in-picture during calls (Pip.kt) ----

    Function("pipSupported") {
      val activity = appContext.currentActivity ?: return@Function false
      Pip.supported(activity)
    }
    Function("setPipCall") { on: Boolean, width: Int, height: Int ->
      val activity = appContext.currentActivity ?: return@Function
      Pip.set(activity, on, width, height)
    }
    Function("enterPip") {
      val activity = appContext.currentActivity ?: return@Function false
      if (!Pip.supported(activity)) return@Function false
      activity.runOnUiThread { Pip.enter(activity) }
      true
    }
    Function("isInPip") {
      Pip.isIn(appContext.currentActivity)
    }
    OnUserLeavesActivity {
      appContext.currentActivity?.let { Pip.onUserLeave(it) }
    }

    // ---- 0.8.0: things shared to Glofly from other apps (ShareIntake.kt) ----

    /** The share waiting for the "Send to…" screen (once), or null. Waits for copying to finish. */
    AsyncFunction("takePendingShare") { _: String? ->
      ShareIntake.take()
    }

    /** Removes a share's copied files once it's sent or cancelled. */
    Function("discardShare") { id: String ->
      if (Regex("^[0-9a-fA-F-]{36}$").matches(id)) {
        java.io.File(java.io.File(context.cacheDir, "glofly-share"), id).deleteRecursively()
      }
    }

    // ---- 0.8.0: keyboard shortcuts (tablets, Chromebooks; KeyCommands.kt) ----

    /** The commands the app can do right now (ids like "quick", "find"); others pass through. */
    Function("setKeyCommands") { ids: List<String> ->
      KeyCommands.enabled = ids.toSet()
    }

    // ---- Voice messages ----

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
      if (instance?.get() === this@GloflyNativeModule) instance = null
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
