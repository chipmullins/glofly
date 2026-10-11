package com.glofly.nativebridge

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps a call going when Glofly leaves the screen: Android only lets an app keep using the
 * microphone (and camera) in the background from a foreground service, which shows the
 * "Call in progress" notification with Hang up.
 */
class OngoingCallService : Service() {
  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_CALL = "callId"
    const val EXTRA_CHAT = "conversationId"
    const val EXTRA_VIDEO = "video"

    fun start(context: Context, callId: String, conversationId: String, title: String, video: Boolean) {
      val intent = Intent(context, OngoingCallService::class.java)
        .putExtra(EXTRA_CALL, callId)
        .putExtra(EXTRA_CHAT, conversationId)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_VIDEO, video)
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, OngoingCallService::class.java))
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Notifier.ensureChannels(this)
    val callId = intent?.getStringExtra(EXTRA_CALL).orEmpty()
    val chat = intent?.getStringExtra(EXTRA_CHAT).orEmpty()
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Glofly call"
    val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) ?: false
    val hangUpIntent = Intent(this, ActionReceiver::class.java).apply {
      action = ActionReceiver.HANG_UP
      putExtra("callId", callId)
    }
    val hangUp = android.app.PendingIntent.getBroadcast(this, Notifier.ONGOING_ID, hangUpIntent, android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE)
    val person = Person.Builder().setName(title).setImportant(true).build()
    val notification = NotificationCompat.Builder(this, Notifier.CH_ONGOING)
      .setSmallIcon(R.drawable.glofly_notification)
      .setColor(Notifier.ACCENT)
      .setContentTitle(title)
      .setContentText(if (video) "Video call in progress" else "Call in progress")
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setUsesChronometer(true)
      .setContentIntent(Notifier.openLink(this, "glofly://chat/$chat", Notifier.ONGOING_ID))
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(person, hangUp).setIsVideo(video))
      .build()

    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      types = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        if (granted(Manifest.permission.RECORD_AUDIO)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (video && granted(Manifest.permission.CAMERA)) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      }
    }
    try {
      ServiceCompat.startForeground(this, Notifier.ONGOING_ID, notification, types)
    } catch (_: Exception) {
      // Android refused (rare: started from the background). The call still works while on screen.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiped away from recent apps: the call ends with the app.
    stopSelf()
  }
}
