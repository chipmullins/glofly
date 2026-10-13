package com.glofly.nativebridge

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.time.Instant

/**
 * Receives Glofly's push messages (Firebase Cloud Messaging). They're data-only, so this runs even
 * when Glofly is closed, and decides what to show: a chat notification, a friend request, a
 * ringing call, a missed call, or removing a notification that was read elsewhere.
 */
class GloflyMessagingService : FirebaseMessagingService() {
  override fun onNewToken(token: String) {
    PushStore.saveFcmToken(applicationContext, token)
    GloflyNativeModule.emitToken(token)
  }

  override fun onMessageReceived(message: RemoteMessage) {
    val d = message.data
    val context = applicationContext
    // Signed out on this phone: ignore anything still on its way.
    if (PushStore.config(context) == null) return
    when (d["type"]) {
      "message" -> {
        val conversationId = d["conversationId"] ?: return
        val isGroup = d["chatKind"] == "group"
        val title = if (isGroup) d["chatTitle"].orEmpty() else d["senderName"].orEmpty()
        val preview = d["preview"] != "0"
        PushStore.saveTitle(context, conversationId, title, isGroup)
        val at = d["sentAt"]?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: System.currentTimeMillis()
        val lines = PushStore.addLine(
          context,
          conversationId,
          PushStore.Line(d["senderId"].orEmpty(), d["senderName"] ?: "Someone", d["senderAvatar"]?.ifEmpty { null }, d["text"] ?: "New message", at),
        )
        Notifier.showChat(context, conversationId, title, isGroup, lines, alert = true, previews = preview)
      }
      "clear" -> d["conversationId"]?.let { Notifier.cancelChat(context, it) }
      "friend_request" -> Notifier.showFriendRequest(context, d["userId"].orEmpty(), d["senderName"] ?: "Someone", d["senderAvatar"]?.ifEmpty { null })
      "friend_online", "friend_joined" -> Notifier.showFriendAlert(
        context,
        d["userId"].orEmpty(),
        d["senderName"] ?: "Someone",
        d["senderAvatar"]?.ifEmpty { null },
        d["text"] ?: if (d["type"] == "friend_online") "is online" else "joined Glofly",
        online = d["type"] == "friend_online",
      )
      "call_ring" -> {
        val callId = d["callId"] ?: return
        val until = d["ringingUntil"]?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: (System.currentTimeMillis() + 23_000)
        val left = until - System.currentTimeMillis()
        if (left <= 500) return // already over
        Notifier.showIncomingCall(
          context,
          callId,
          d["conversationId"].orEmpty(),
          d["callerId"].orEmpty(),
          d["callerName"] ?: "Someone",
          d["callerAvatar"]?.ifEmpty { null },
          d["chatTitle"].orEmpty(),
          d["video"] == "1",
          left,
          silent = d["dnd"] == "1",
        )
        GloflyNativeModule.emitEvent("callRing", mapOf("callId" to callId))
      }
      "call_stop" -> d["callId"]?.let { Notifier.cancelCall(context, it) }
      "call_missed" -> {
        val callId = d["callId"] ?: return
        if (d["dnd"] == "1") {
          Notifier.cancelCall(context, callId)
          return
        }
        Notifier.showMissedCall(
          context,
          callId,
          d["conversationId"].orEmpty(),
          d["title"] ?: (d["callerName"] ?: "Missed call"),
          d["text"] ?: "Missed call",
          d["callerId"].orEmpty(),
          d["callerName"] ?: "Someone",
          d["callerAvatar"]?.ifEmpty { null },
        )
      }
    }
  }
}
