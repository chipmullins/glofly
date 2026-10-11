package com.glofly.nativebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Buttons on notifications that work without opening Glofly: Reply and Mark as read on a chat,
 * Decline on a ringing call. They call the server directly with the saved session.
 */
class ActionReceiver : BroadcastReceiver() {
  companion object {
    const val REPLY = "com.glofly.action.REPLY"
    const val READ = "com.glofly.action.READ"
    const val DECLINE = "com.glofly.action.DECLINE"
    const val HANG_UP = "com.glofly.action.HANG_UP"
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == HANG_UP) {
      // Glofly is running (the call notification only exists during a call): it leaves the call.
      GloflyNativeModule.emitEvent("hangUp", mapOf("callId" to (intent.getStringExtra("callId") ?: "")))
      OngoingCallService.stop(context)
    }
    val pending = goAsync()
    val app = context.applicationContext
    thread {
      try {
        handle(app, intent)
      } finally {
        pending.finish()
      }
    }
  }

  private fun handle(context: Context, intent: Intent) {
    val config = PushStore.config(context) ?: return
    when (intent.action) {
      REPLY -> {
        val conversationId = intent.getStringExtra("conversationId") ?: return
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Notifier.KEY_REPLY)?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return
        val body = JSONObject().put("body", text.take(4000)).toString()
        val status = Http.send(config, "POST", "/conversations/$conversationId/messages", body)
        val (title, isGroup) = PushStore.title(context, conversationId)
        if (status in 200..299) {
          // Show the reply in the notification (the server marks the chat read when you send).
          val lines = PushStore.addLine(context, conversationId, PushStore.Line(config.meId, "You", null, text, System.currentTimeMillis()))
          Notifier.showChat(context, conversationId, title, isGroup, lines, alert = false, previews = true)
        } else {
          val lines = PushStore.addLine(context, conversationId, PushStore.Line("glofly", "Glofly", null, "Couldn't send your reply. Open Glofly to try again.", System.currentTimeMillis()))
          Notifier.showChat(context, conversationId, title, isGroup, lines, alert = false, previews = true)
        }
      }
      READ -> {
        val conversationId = intent.getStringExtra("conversationId") ?: return
        Notifier.cancelChat(context, conversationId)
        Http.send(config, "POST", "/conversations/$conversationId/read", null)
      }
      HANG_UP -> {
        val callId = intent.getStringExtra("callId") ?: return
        if (callId.isNotEmpty()) Http.send(config, "POST", "/calls/$callId/leave", null)
      }
      DECLINE -> {
        val callId = intent.getStringExtra("callId") ?: return
        Notifier.cancelCall(context, callId)
        Http.send(config, "POST", "/calls/$callId/decline", null)
      }
    }
  }
}
