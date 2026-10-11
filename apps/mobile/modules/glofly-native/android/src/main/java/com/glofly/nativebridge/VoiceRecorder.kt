package com.glofly.nativebridge

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import java.io.File

/**
 * Records voice messages as Opus (in Ogg) on Android 10+, which every Glofly app can play.
 * Older Android versions record Vorbis in WebM instead (the server accepts both containers).
 */
class VoiceRecorder(private val context: Context) {
  private var recorder: MediaRecorder? = null
  private var file: File? = null
  private var startedAt = 0L
  private var mime = "audio/ogg"

  val isRecording get() = recorder != null

  fun start() {
    stopQuietly()
    val opus = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    mime = if (opus) "audio/ogg" else "audio/webm"
    val out = File(context.cacheDir, "voice-${System.currentTimeMillis()}.${if (opus) "ogg" else "webm"}")
    @Suppress("DEPRECATION")
    val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else MediaRecorder()
    r.setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
    if (opus) {
      r.setOutputFormat(MediaRecorder.OutputFormat.OGG)
      r.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
    } else {
      r.setOutputFormat(MediaRecorder.OutputFormat.WEBM)
      r.setAudioEncoder(MediaRecorder.AudioEncoder.VORBIS)
    }
    r.setAudioChannels(1)
    r.setAudioSamplingRate(48000)
    r.setAudioEncodingBitRate(32000)
    r.setOutputFile(out.absolutePath)
    try {
      r.prepare()
      r.start()
    } catch (e: Exception) {
      r.release()
      out.delete()
      throw e
    }
    recorder = r
    file = out
    startedAt = SystemClock.elapsedRealtime()
  }

  /** Loudness since the last call, 0–1 (for the live bars and the waveform). */
  fun level(): Double {
    val r = recorder ?: return 0.0
    return try {
      (r.maxAmplitude / 32767.0).coerceIn(0.0, 1.0)
    } catch (_: Exception) {
      0.0
    }
  }

  /** Stops and returns the file (null if nothing usable was recorded). */
  fun stop(): Map<String, Any>? {
    val r = recorder ?: return null
    val out = file
    val duration = SystemClock.elapsedRealtime() - startedAt
    recorder = null
    file = null
    val ok = try {
      r.stop()
      true
    } catch (_: Exception) {
      false // stop() throws when almost nothing was recorded
    } finally {
      r.release()
    }
    if (!ok || out == null || !out.exists() || out.length() == 0L) {
      out?.delete()
      return null
    }
    return mapOf("uri" to "file://${out.absolutePath}", "durationMs" to duration.toDouble(), "mime" to mime, "size" to out.length().toDouble())
  }

  fun cancel() {
    val out = file
    stopQuietly()
    out?.delete()
  }

  private fun stopQuietly() {
    val r = recorder ?: return
    recorder = null
    file = null
    try {
      r.stop()
    } catch (_: Exception) {
    }
    r.release()
  }
}
