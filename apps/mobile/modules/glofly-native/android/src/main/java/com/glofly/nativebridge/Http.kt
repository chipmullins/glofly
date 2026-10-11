package com.glofly.nativebridge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.net.HttpURLConnection
import java.net.URL

/** Small calls to the Glofly server from native code (replies, declines, profile photos). */
object Http {
  private fun open(c: PushStore.Config, path: String, method: String): HttpURLConnection {
    val conn = URL(c.serverUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
    conn.requestMethod = method
    conn.connectTimeout = 10_000
    conn.readTimeout = 10_000
    conn.setRequestProperty("Authorization", "Bearer ${c.token}")
    conn.setRequestProperty("X-Glofly-Version", c.version)
    conn.setRequestProperty("X-Glofly-Platform", c.platform)
    return conn
  }

  /** Sends JSON; returns the HTTP status (or -1 if the server couldn't be reached). */
  fun send(c: PushStore.Config, method: String, path: String, json: String?): Int =
    try {
      val conn = open(c, path, method)
      if (json != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
      }
      val code = conn.responseCode
      conn.disconnect()
      code
    } catch (_: Exception) {
      -1
    }

  /** A picture that needs the session (profile and group photos); null if it can't be loaded. */
  fun bitmap(c: PushStore.Config, path: String): Bitmap? =
    try {
      val conn = open(c, path, "GET")
      val bmp = if (conn.responseCode == 200) conn.inputStream.use { BitmapFactory.decodeStream(it) } else null
      conn.disconnect()
      bmp
    } catch (_: Exception) {
      null
    }
}
