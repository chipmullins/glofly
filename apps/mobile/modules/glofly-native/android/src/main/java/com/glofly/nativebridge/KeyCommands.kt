package com.glofly.nativebridge

import android.view.KeyEvent

/**
 * 0.8.0 keyboard shortcuts on Android tablets and Chromebooks (Ctrl where the iPad has ⌘): the
 * same commands as the iPad (modules/glofly-native/ios/KeyCommands.swift). The app turns each on
 * only while it can do something with it (setKeyCommands); a key that isn't on goes on as usual.
 */
object KeyCommands {
  @Volatile var enabled: Set<String> = emptySet()

  /** The command a key press means, if any (keys a text field used never get here). */
  fun match(keyCode: Int, e: KeyEvent): String? {
    val ctrl = e.isCtrlPressed
    val alt = e.isAltPressed
    val shift = e.isShiftPressed
    val meta = e.isMetaPressed
    if (ctrl && !alt && !meta && !shift) {
      return when (keyCode) {
        KeyEvent.KEYCODE_K -> "quick"
        KeyEvent.KEYCODE_SLASH -> "shortcuts"
        KeyEvent.KEYCODE_N -> "newMessage"
        KeyEvent.KEYCODE_F -> "find"
        else -> null
      }
    }
    if (alt && !ctrl && !meta && !shift) {
      return when (keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "prevNebula"
        KeyEvent.KEYCODE_DPAD_DOWN -> "nextNebula"
        else -> null
      }
    }
    if (!ctrl && !alt && !meta && !shift) {
      return when (keyCode) {
        KeyEvent.KEYCODE_ESCAPE -> "escape"
        KeyEvent.KEYCODE_DPAD_UP -> "editLast"
        else -> null
      }
    }
    return null
  }

  /** From the activity: true when the key was a Glofly command (then nothing else gets it). */
  fun onKeyDown(keyCode: Int, e: KeyEvent?): Boolean {
    if (e == null) return false
    val id = match(keyCode, e) ?: return false
    if (id !in enabled) return false
    // Held down: the nebula keys keep stepping; the others fire once.
    if (e.repeatCount > 0 && id != "prevNebula" && id != "nextNebula") return true
    GloflyNativeModule.emitEvent("keyCommand", mapOf("id" to id))
    return true
  }
}
