package com.glofly.nativebridge

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the push code needs when Glofly's JavaScript isn't running: where the server is, the
 * session (to send a reply or decline a call from a notification), who you are, and the last few
 * lines of each chat's notification.
 *
 * Kept in this app's private storage only, and cleared when you sign out.
 */
object PushStore {
  private const val FILE = "glofly_push"

  data class Config(
    val serverUrl: String,
    val token: String,
    val version: String,
    val platform: String,
    val meId: String,
    val meName: String,
    val meAvatar: String?,
    val vibrate: Boolean,
  )

  private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun saveConfig(context: Context, c: Config) {
    prefs(context).edit()
      .putString("serverUrl", c.serverUrl)
      .putString("token", c.token)
      .putString("version", c.version)
      .putString("platform", c.platform)
      .putString("meId", c.meId)
      .putString("meName", c.meName)
      .putString("meAvatar", c.meAvatar)
      .putBoolean("vibrate", c.vibrate)
      .apply()
  }

  fun config(context: Context): Config? {
    val p = prefs(context)
    val server = p.getString("serverUrl", null) ?: return null
    val token = p.getString("token", null) ?: return null
    return Config(
      server,
      token,
      p.getString("version", "1.0.0") ?: "1.0.0",
      p.getString("platform", "android") ?: "android",
      p.getString("meId", "") ?: "",
      p.getString("meName", "You") ?: "You",
      p.getString("meAvatar", null),
      p.getBoolean("vibrate", true),
    )
  }

  fun clear(context: Context) {
    val token = prefs(context).getString("fcmToken", null)
    prefs(context).edit().clear().apply()
    if (token != null) prefs(context).edit().putString("fcmToken", token).apply()
  }

  fun saveFcmToken(context: Context, token: String) = prefs(context).edit().putString("fcmToken", token).apply()
  fun fcmToken(context: Context): String? = prefs(context).getString("fcmToken", null)

  // ---- Lines shown in each chat's notification (newest last, at most 8) ----

  data class Line(val senderId: String, val senderName: String, val avatar: String?, val text: String, val at: Long)

  fun addLine(context: Context, conversationId: String, line: Line): List<Line> {
    val list = lines(context, conversationId).toMutableList()
    list.add(line)
    while (list.size > 8) list.removeAt(0)
    val arr = JSONArray()
    for (l in list) {
      arr.put(JSONObject().put("s", l.senderId).put("n", l.senderName).put("a", l.avatar ?: "").put("t", l.text).put("at", l.at))
    }
    prefs(context).edit().putString("lines:$conversationId", arr.toString()).apply()
    return list
  }

  fun lines(context: Context, conversationId: String): List<Line> {
    val raw = prefs(context).getString("lines:$conversationId", null) ?: return emptyList()
    return try {
      val arr = JSONArray(raw)
      (0 until arr.length()).map { i ->
        val o = arr.getJSONObject(i)
        Line(o.optString("s"), o.optString("n"), o.optString("a").ifEmpty { null }, o.optString("t"), o.optLong("at"))
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  fun clearLines(context: Context, conversationId: String) = prefs(context).edit().remove("lines:$conversationId").apply()

  fun clearAllLines(context: Context) {
    val p = prefs(context)
    val e = p.edit()
    for (key in p.all.keys) if (key.startsWith("lines:")) e.remove(key)
    e.apply()
  }

  // Chat titles, so a reply can rebuild the notification.
  fun saveTitle(context: Context, conversationId: String, title: String, isGroup: Boolean) =
    prefs(context).edit().putString("title:$conversationId", title).putBoolean("group:$conversationId", isGroup).apply()

  fun title(context: Context, conversationId: String): Pair<String, Boolean> =
    Pair(prefs(context).getString("title:$conversationId", "") ?: "", prefs(context).getBoolean("group:$conversationId", false))
}
