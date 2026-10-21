package com.glofly.nativebridge

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.IntentCompat
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.concurrent.thread

/**
 * 0.8.0 "Share to Glofly": a photo, video, file, link or text shared to Glofly from another app
 * (ACTION_SEND / ACTION_SEND_MULTIPLE on the main activity, see plugins/with-share-intent.js).
 *
 * Shared files arrive as content:// addresses that only this launch may read, so they're copied
 * into Glofly's cache straight away (off the main thread); the app's "Send to…" screen then takes
 * the whole share with takePendingShare() and uploads the copies like picked photos.
 *
 * Only content:// addresses from other apps are read: file:// addresses and Glofly's own providers
 * are refused, so another app can't make Glofly send its own private files (like the session).
 */
object ShareIntake {
  private const val DIR = "glofly-share"
  private const val MAX_FILES = 10
  /** Bigger than any upload Glofly takes (videos 64 MB); the app says it's too big. */
  private const val MAX_BYTES = 80L * 1024 * 1024

  // A lock + condition (Kotlin's Any has no wait/notify).
  private val lock = ReentrantLock()
  private val done = lock.newCondition()
  private var pending: Map<String, Any?>? = null
  private var working = 0
  private var lastKey: String? = null
  private var lastAt = 0L

  fun isShare(intent: Intent?): Boolean =
    intent != null && (intent.action == Intent.ACTION_SEND || intent.action == Intent.ACTION_SEND_MULTIPLE)

  /** A share arrived (launch or new intent): copy it in the background, then tell the app. */
  fun handle(context: Context, intent: Intent?) {
    if (!isShare(intent)) return
    // Reopened from the recent apps list: Android hands back the old share; it was taken already.
    if ((intent!!.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
    // The activity being recreated straight away hands the same share over again: once is enough.
    // (Only for a few seconds: sharing the same link again later, to another chat, still works.)
    val key = listOf(intent.action, intent.type, intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString(), IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.toString(), intent.clipData?.toString()).joinToString("|")
    lock.withLock {
      if (key == lastKey && System.currentTimeMillis() - lastAt < 5_000L) return
      lastKey = key
      lastAt = System.currentTimeMillis()
    }
    val app = context.applicationContext
    val copy = Intent(intent)
    lock.withLock { working++ }
    thread(name = "glofly-share") {
      val payload = try {
        read(app, copy)
      } catch (_: Exception) {
        null
      }
      lock.withLock {
        working--
        if (payload != null) pending = payload
        done.signalAll()
      }
      if (payload != null) GloflyNativeModule.emitEvent("share", mapOf("id" to payload["id"]))
    }
  }

  /** The waiting share (once), after any copying still going on (up to timeoutMs). */
  fun take(timeoutMs: Long = 30_000): Map<String, Any?>? {
    lock.withLock {
      val until = System.currentTimeMillis() + timeoutMs
      while (working > 0) {
        val left = until - System.currentTimeMillis()
        if (left <= 0) break
        done.await(left, TimeUnit.MILLISECONDS)
      }
      val p = pending
      pending = null
      return p
    }
  }

  private fun read(context: Context, intent: Intent): Map<String, Any?>? {
    cleanOld(context)
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()?.ifEmpty { null }
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()?.ifEmpty { null }
    val uris = LinkedHashSet<Uri>()
    if (intent.action == Intent.ACTION_SEND_MULTIPLE) {
      IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris.addAll(it) }
    } else {
      IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)?.let { uris.add(it) }
    }
    if (uris.isEmpty()) {
      val clip = intent.clipData
      if (clip != null) for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
    }
    val id = UUID.randomUUID().toString()
    val folder = File(File(context.cacheDir, DIR), id)
    val files = ArrayList<Map<String, Any?>>()
    var skipped = 0
    for (uri in uris) {
      if (files.size >= MAX_FILES) {
        skipped++
        continue
      }
      val file = copyIn(context, uri, folder, intent.type)
      if (file == null) skipped++ else files.add(file)
    }
    if (text == null && files.isEmpty()) return null
    return mapOf(
      "id" to id,
      "text" to text,
      "subject" to subject,
      "files" to files,
      "skipped" to skipped,
    )
  }

  private fun copyIn(context: Context, uri: Uri, folder: File, intentType: String?): Map<String, Any?>? {
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) return null
    val authority = uri.authority ?: return null
    val owner = try {
      context.packageManager.resolveContentProvider(authority, 0)?.packageName
    } catch (_: Exception) {
      null
    }
    if (owner == context.packageName) return null
    val resolver = context.contentResolver
    var name: String? = null
    var declaredSize: Long? = null
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val s = c.getColumnIndex(OpenableColumns.SIZE)
          if (n >= 0 && !c.isNull(n)) name = c.getString(n)
          if (s >= 0 && !c.isNull(s)) declaredSize = c.getLong(s)
        }
      }
    } catch (_: Exception) {
    }
    val mime = (try { resolver.getType(uri) } catch (_: Exception) { null })
      ?: intentType?.takeIf { !it.endsWith("/*") && it != "*/*" }
      ?: "application/octet-stream"
    val safe = safeName(name, mime)
    if ((declaredSize ?: 0L) > MAX_BYTES) {
      return mapOf("uri" to null, "name" to safe, "mimeType" to mime, "size" to declaredSize, "tooBig" to true)
    }
    folder.mkdirs()
    val out = File(folder, uniqueName(folder, safe))
    var total = 0L
    try {
      val input = resolver.openInputStream(uri) ?: return null
      input.use { inp ->
        out.outputStream().use { o ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = inp.read(buf)
            if (n < 0) break
            total += n
            if (total > MAX_BYTES) {
              o.close()
              out.delete()
              return mapOf("uri" to null, "name" to safe, "mimeType" to mime, "size" to total, "tooBig" to true)
            }
            o.write(buf, 0, n)
          }
        }
      }
    } catch (_: Exception) {
      out.delete()
      return null
    }
    return mapOf("uri" to Uri.fromFile(out).toString(), "name" to safe, "mimeType" to mime, "size" to total, "tooBig" to false)
  }

  /** A plain file name (no folders), with an extension that matches the type when it had none. */
  private fun safeName(raw: String?, mime: String): String {
    var n = (raw ?: "").substringAfterLast('/').substringAfterLast('\\').replace(Regex("[\\u0000-\\u001f]"), "").trim()
    if (n.isEmpty() || n == "." || n == "..") {
      val base = when {
        mime.startsWith("image/") -> "Photo"
        mime.startsWith("video/") -> "Video"
        else -> "File"
      }
      n = base
    }
    if (!n.contains('.')) {
      MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)?.let { n = "$n.$it" }
    }
    return n.take(120)
  }

  private fun uniqueName(folder: File, name: String): String {
    if (!File(folder, name).exists()) return name
    val dot = name.lastIndexOf('.')
    val stem = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var i = 2
    while (File(folder, "$stem ($i)$ext").exists()) i++
    return "$stem ($i)$ext"
  }

  /** Copies from shares more than a day old (sent or abandoned). */
  private fun cleanOld(context: Context) {
    val root = File(context.cacheDir, DIR)
    val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
    root.listFiles()?.forEach { if (it.lastModified() < cutoff) it.deleteRecursively() }
  }
}
