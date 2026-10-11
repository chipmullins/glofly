package com.glofly.nativebridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Glofly's own Android code, reached from JavaScript as `GloflyNative`:
 * voice-message recording (Opus), and later push notifications and call ringing.
 */
class GloflyNativeModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "No React context" }

  private var voice: VoiceRecorder? = null
  private fun recorder(): VoiceRecorder = voice ?: VoiceRecorder(context.applicationContext).also { voice = it }

  override fun definition() = ModuleDefinition {
    Name("GloflyNative")

    AsyncFunction("startVoice") {
      recorder().start()
    }
    Function("voiceLevel") {
      voice?.level() ?: 0.0
    }
    AsyncFunction("stopVoice") {
      voice?.stop()
    }
    Function("cancelVoice") {
      voice?.cancel()
    }

    OnDestroy {
      voice?.cancel()
    }
  }
}
