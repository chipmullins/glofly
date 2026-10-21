package com.glofly.nativebridge

import android.content.Context
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

/**
 * Hooks into Glofly's main activity (Expo finds this class by its name and the Package import):
 * keyboard shortcuts (KeyCommands), 0.8.1.
 */
class GloflyNativePackage : Package {
  override fun createReactActivityHandlers(activityContext: Context?): List<ReactActivityHandler> =
    listOf(KeyHandler())
}

private class KeyHandler : ReactActivityHandler {
  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean = KeyCommands.onKeyDown(keyCode, event)
}
