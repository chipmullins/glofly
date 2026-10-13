package com.glofly.nativebridge

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational
import androidx.core.app.OnPictureInPictureModeChangedProvider
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import java.lang.ref.WeakReference

/**
 * Picture-in-picture during calls (Oct 13): leaving Glofly mid-call shrinks it into a small
 * floating window instead of hiding it. The JavaScript side turns it on while a call is going
 * (setPipCall) and shows a call-only view while in the window (src/calls/CallPip.tsx).
 *
 * - Android 12+: the system enters the window by itself when you leave (setAutoEnterEnabled), with
 *   the smooth animation.
 * - Android 8–11: entered from onUserLeaveHint (Home / Recents), which Expo passes to modules as
 *   OnUserLeavesActivity.
 * - The app's MainActivity needs android:supportsPictureInPicture (plugins/with-picture-in-picture.js).
 */
object Pip {
  var enabled = false
    private set
  private var aspect = Rational(9, 16)
  private var listening: WeakReference<Activity>? = null
  private val listener = Consumer<PictureInPictureModeChangedInfo> { info ->
    GloflyNativeModule.emitEvent("pipChanged", mapOf("inPip" to info.isInPictureInPictureMode))
  }

  fun supported(activity: Activity): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  /** Android only allows shapes between 1:2.39 and 2.39:1. */
  private fun clamp(w: Int, h: Int): Rational {
    if (w <= 0 || h <= 0) return Rational(9, 16)
    val r = w.toDouble() / h
    return when {
      r > 2.39 -> Rational(239, 100)
      r < 1 / 2.39 -> Rational(100, 239)
      else -> Rational(w, h)
    }
  }

  private fun params(): PictureInPictureParams? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    val b = PictureInPictureParams.Builder().setAspectRatio(aspect)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      b.setAutoEnterEnabled(enabled)
      b.setSeamlessResizeEnabled(true)
    }
    return b.build()
  }

  fun set(activity: Activity, on: Boolean, w: Int, h: Int) {
    enabled = on
    aspect = clamp(w, h)
    if (!supported(activity) || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    activity.runOnUiThread {
      listen(activity)
      try {
        params()?.let { activity.setPictureInPictureParams(it) }
      } catch (_: Exception) {
        // e.g. the activity isn't set up for PiP (older build without the manifest flag)
      }
    }
  }

  /** Android 8–11: Home / Recents pressed during a call. */
  fun onUserLeave(activity: Activity) {
    if (!enabled || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S || !supported(activity)) return
    enter(activity)
  }

  fun enter(activity: Activity): Boolean {
    if (!supported(activity) || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    return try {
      params()?.let { activity.enterPictureInPictureMode(it) } ?: false
    } catch (_: Exception) {
      false
    }
  }

  fun isIn(activity: Activity?): Boolean =
    activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && activity.isInPictureInPictureMode

  private fun listen(activity: Activity) {
    if (listening?.get() === activity) return
    (listening?.get() as? OnPictureInPictureModeChangedProvider)?.removeOnPictureInPictureModeChangedListener(listener)
    (activity as? OnPictureInPictureModeChangedProvider)?.addOnPictureInPictureModeChangedListener(listener)
    listening = WeakReference(activity)
  }
}
