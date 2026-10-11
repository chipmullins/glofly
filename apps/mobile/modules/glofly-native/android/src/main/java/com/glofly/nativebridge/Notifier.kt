package com.glofly.nativebridge

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.graphics.drawable.IconCompat
import kotlin.math.abs

/**
 * Builds Glofly's Android notifications: one per chat (MessagingStyle, with Reply and Mark as
 * read), friend requests, ringing calls (full screen on the lock screen) and missed calls.
 */
object Notifier {
  const val CH_MESSAGES = "glofly_messages"
  const val CH_FRIENDS = "glofly_friends"
  const val CH_CALLS = "glofly_calls_ring"
  const val CH_CALLS_SILENT = "glofly_calls_silent"
  const val CH_MISSED = "glofly_missed_calls"
  const val CH_ONGOING = "glofly_ongoing_call"

  const val KEY_REPLY = "glofly_reply"
  const val ACCENT = 0xFFF47A1F.toInt()

  fun chatId(conversationId: String) = 1000 + abs(conversationId.hashCode() % 1_000_000)
  fun callId(callId: String) = 2_000_000 + abs(callId.hashCode() % 1_000_000)
  const val FRIENDS_ID = 3_000_001
  const val ONGOING_ID = 3_000_002

  private fun raw(context: Context, name: String): Uri =
    Uri.parse("${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/raw/$name")

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val notifAttrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    val ringAttrs = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    nm.createNotificationChannel(
      NotificationChannel(CH_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "New messages in your chats and groups"
        setSound(raw(context, "glofly_message"), notifAttrs)
        enableVibration(true)
      },
    )
    nm.createNotificationChannel(
      NotificationChannel(CH_FRIENDS, "Friend requests", NotificationManager.IMPORTANCE_DEFAULT).apply {
        setSound(raw(context, "glofly_message"), notifAttrs)
      },
    )
    nm.createNotificationChannel(
      NotificationChannel(CH_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Rings when someone calls you"
        setSound(raw(context, "glofly_ringtone"), ringAttrs)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 900, 700, 900, 700)
        lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
      },
    )
    nm.createNotificationChannel(
      NotificationChannel(CH_CALLS_SILENT, "Incoming calls (Do not disturb)", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Calls while you're set to Do not disturb: shown without sound"
        setSound(null, null)
        enableVibration(false)
        lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
      },
    )
    nm.createNotificationChannel(NotificationChannel(CH_MISSED, "Missed calls", NotificationManager.IMPORTANCE_DEFAULT))
    nm.createNotificationChannel(
      NotificationChannel(CH_ONGOING, "Call in progress", NotificationManager.IMPORTANCE_LOW).apply {
        setSound(null, null)
        enableVibration(false)
      },
    )
  }

  private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

  /** Opens Glofly at a link like glofly://chat/<id> (Expo Router takes it from there). */
  fun openLink(context: Context, link: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(link)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(context, requestCode, intent, flags())
  }

  private fun action(context: Context, what: String, extras: Map<String, String>, requestCode: Int, mutable: Boolean = false): PendingIntent {
    val intent = Intent(context, ActionReceiver::class.java).apply {
      action = what
      for ((k, v) in extras) putExtra(k, v)
    }
    val f = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
    return PendingIntent.getBroadcast(context, requestCode, intent, f)
  }

  fun round(src: Bitmap?): Bitmap? {
    if (src == null) return null
    val size = minOf(src.width, src.height)
    val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    canvas.drawARGB(0, 0, 0, 0)
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
    val left = (src.width - size) / 2
    val top = (src.height - size) / 2
    canvas.drawBitmap(src, Rect(left, top, left + size, top + size), Rect(0, 0, size, size), paint)
    return out
  }

  /** Initials on a colored circle, for people without a photo (same colors as the app). */
  fun initialsBitmap(id: String, name: String): Bitmap {
    val palette = arrayOf(
      intArrayOf(0xFFFBDCC4.toInt(), 0xFF8A3005.toInt()), intArrayOf(0xFFD7E5F5.toInt(), 0xFF1E4E8C.toInt()),
      intArrayOf(0xFFDDEBD9.toInt(), 0xFF2F6B3A.toInt()), intArrayOf(0xFFEADCF5.toInt(), 0xFF5B3A8C.toInt()),
      intArrayOf(0xFFF5DCDC.toInt(), 0xFF8C2F2F.toInt()), intArrayOf(0xFFF3E7C5.toInt(), 0xFF6E5310.toInt()),
      intArrayOf(0xFFE2E8EC.toInt(), 0xFF3A4B57.toInt()),
    )
    var hash = 0L
    for (ch in id) hash = (hash * 31 + ch.code) and 0xFFFFFFFFL
    val (bg, fg) = palette[(hash % palette.size).toInt()].let { Pair(it[0], it[1]) }
    val size = 128
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = bg }
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, p)
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val text = ((words.firstOrNull()?.take(1) ?: "?") + (if (words.size > 1) words.last().take(1) else "")).uppercase()
    p.color = fg
    p.textSize = 48f
    p.textAlign = Paint.Align.CENTER
    p.isFakeBoldText = true
    canvas.drawText(text, size / 2f, size / 2f - (p.descent() + p.ascent()) / 2, p)
    return bmp
  }

  private fun personFor(context: Context, c: PushStore.Config?, id: String, name: String, avatar: String?): Person {
    val bmp = if (c != null && !avatar.isNullOrEmpty()) round(Http.bitmap(c, "/avatars/$id/$avatar")) else null
    return Person.Builder()
      .setKey(id)
      .setName(name)
      .setIcon(IconCompat.createWithBitmap(bmp ?: initialsBitmap(id, name)))
      .build()
  }

  /** Shows (or updates) a chat's notification with its latest lines. */
  fun showChat(context: Context, conversationId: String, title: String, isGroup: Boolean, lines: List<PushStore.Line>, alert: Boolean, previews: Boolean) {
    ensureChannels(context)
    val c = PushStore.config(context)
    val me = Person.Builder().setKey(c?.meId ?: "me").setName("You").build()
    val style = NotificationCompat.MessagingStyle(me)
    if (isGroup) {
      style.conversationTitle = title
      style.isGroupConversation = true
    }
    val people = HashMap<String, Person>()
    for (l in lines) {
      val person = if (l.senderId == c?.meId) null else people.getOrPut(l.senderId) { personFor(context, c, l.senderId, l.senderName, l.avatar) }
      style.addMessage(NotificationCompat.MessagingStyle.Message(l.text, l.at, person))
    }
    val id = chatId(conversationId)
    val builder = NotificationCompat.Builder(context, CH_MESSAGES)
      .setSmallIcon(R.drawable.glofly_notification)
      .setColor(ACCENT)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setOnlyAlertOnce(!alert)
      .setShortcutId(conversationId)
      .setContentIntent(openLink(context, "glofly://chat/$conversationId", id))
      .setVisibility(if (previews) NotificationCompat.VISIBILITY_PRIVATE else NotificationCompat.VISIBILITY_SECRET)
    if (previews) {
      val remote = RemoteInput.Builder(KEY_REPLY).setLabel(if (isGroup) "Message $title" else "Reply").build()
      val reply = NotificationCompat.Action.Builder(
        IconCompat.createWithResource(context, R.drawable.glofly_notification),
        "Reply",
        action(context, ActionReceiver.REPLY, mapOf("conversationId" to conversationId), id, mutable = true),
      )
        .addRemoteInput(remote)
        .setAllowGeneratedReplies(true)
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .setShowsUserInterface(false)
        .build()
      builder.addAction(reply)
    }
    builder.addAction(
      NotificationCompat.Action.Builder(
        IconCompat.createWithResource(context, R.drawable.glofly_notification),
        "Mark as read",
        action(context, ActionReceiver.READ, mapOf("conversationId" to conversationId), id + 500_000),
      ).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ).setShowsUserInterface(false).build(),
    )
    if (c?.vibrate == false) builder.setVibrate(longArrayOf(0))
    notify(context, id, builder)
  }

  fun cancelChat(context: Context, conversationId: String) {
    NotificationManagerCompat.from(context).cancel(chatId(conversationId))
    PushStore.clearLines(context, conversationId)
  }

  fun showFriendRequest(context: Context, userId: String, name: String, avatar: String?) {
    ensureChannels(context)
    val c = PushStore.config(context)
    val bmp = if (c != null && !avatar.isNullOrEmpty()) round(Http.bitmap(c, "/avatars/$userId/$avatar")) else null
    val b = NotificationCompat.Builder(context, CH_FRIENDS)
      .setSmallIcon(R.drawable.glofly_notification)
      .setColor(ACCENT)
      .setLargeIcon(bmp ?: initialsBitmap(userId, name))
      .setContentTitle(name)
      .setContentText("sent you a friend request")
      .setCategory(NotificationCompat.CATEGORY_SOCIAL)
      .setAutoCancel(true)
      .setContentIntent(openLink(context, "glofly://friends", FRIENDS_ID))
    notify(context, FRIENDS_ID, b)
  }

  /** Ringing: full screen on the lock screen, a heads-up card otherwise, until it times out. */
  fun showIncomingCall(
    context: Context,
    callId: String,
    conversationId: String,
    callerId: String,
    callerName: String,
    callerAvatar: String?,
    chatTitle: String,
    video: Boolean,
    timeoutMs: Long,
    silent: Boolean,
  ) {
    ensureChannels(context)
    val c = PushStore.config(context)
    val id = callId(callId)
    val caller = personFor(context, c, callerId, callerName, callerAvatar)
    val link = "glofly://incoming/$callId?chat=$conversationId&video=${if (video) 1 else 0}"
    val fullScreen = openLink(context, link, id)
    val answer = openLink(context, "$link&answer=1", id + 1)
    val decline = action(context, ActionReceiver.DECLINE, mapOf("callId" to callId, "conversationId" to conversationId), id + 2)
    val kind = if (video) "video call" else "voice call"
    val text = if (chatTitle.isNotEmpty()) "Group $kind · $chatTitle" else "Incoming $kind"
    val builder = NotificationCompat.Builder(context, if (silent) CH_CALLS_SILENT else CH_CALLS)
      .setSmallIcon(R.drawable.glofly_notification)
      .setColor(ACCENT)
      .setContentTitle(callerName)
      .setContentText(text)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(fullScreen, true)
      .setContentIntent(fullScreen)
      .setTimeoutAfter(timeoutMs.coerceAtLeast(1_000))
      .setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, decline, answer).setIsVideo(video))
    val notification = builder.build()
    // Keeps the ringtone going (one loop of it at a time) until answered, declined or over.
    if (!silent) notification.flags = notification.flags or android.app.Notification.FLAG_INSISTENT
    try {
      NotificationManagerCompat.from(context).notify(id, notification)
    } catch (_: SecurityException) {
      // Notifications turned off: nothing to show.
    }
  }

  fun cancelCall(context: Context, callId: String) {
    NotificationManagerCompat.from(context).cancel(callId(callId))
  }

  fun showMissedCall(context: Context, callId: String, conversationId: String, title: String, text: String, callerId: String, callerName: String, callerAvatar: String?) {
    ensureChannels(context)
    cancelCall(context, callId)
    val c = PushStore.config(context)
    val bmp = if (c != null && !callerAvatar.isNullOrEmpty()) round(Http.bitmap(c, "/avatars/$callerId/$callerAvatar")) else null
    val id = callId(callId) + 3
    val b = NotificationCompat.Builder(context, CH_MISSED)
      .setSmallIcon(R.drawable.glofly_notification)
      .setColor(ACCENT)
      .setLargeIcon(bmp ?: initialsBitmap(callerId, callerName))
      .setContentTitle(title)
      .setContentText(text)
      .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
      .setAutoCancel(true)
      .setContentIntent(openLink(context, "glofly://chat/$conversationId", id))
    notify(context, id, b)
  }

  private fun notify(context: Context, id: Int, b: NotificationCompat.Builder) {
    try {
      NotificationManagerCompat.from(context).notify(id, b.build())
    } catch (_: SecurityException) {
      // Notifications turned off for Glofly.
    }
  }

  fun cancelAll(context: Context) {
    NotificationManagerCompat.from(context).cancelAll()
    PushStore.clearAllLines(context)
  }
}
