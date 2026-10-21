package com.glofly.nativebridge

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Hooks into Glofly's main activity (Expo finds this class by its name and the Package import):
 * things shared to Glofly (ShareIntake) and keyboard shortcuts (KeyCommands), 0.8.0.
 */
class GloflyNativePackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(ShareListener())

  override fun createReactActivityHandlers(activityContext: Context?): List<ReactActivityHandler> =
    listOf(KeyHandler())
}

private class ShareListener : ReactActivityLifecycleListener {
  private var app: Context? = null

  override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
    if (activity == null) return
    app = activity.applicationContext
    // Recreated (not newly launched): the share it came with was handled the first time.
    if (savedInstanceState != null) return
    ShareIntake.handle(activity, activity.intent)
  }

  override fun onNewIntent(intent: Intent?): Boolean {
    if (!ShareIntake.isShare(intent)) return false
    val context = app ?: return false
    ShareIntake.handle(context, intent)
    return true
  }
}

private class KeyHandler : ReactActivityHandler {
  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean = KeyCommands.onKeyDown(keyCode, event)
}
