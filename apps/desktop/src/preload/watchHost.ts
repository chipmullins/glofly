// 0.9.3: the only thing the Watch Together player page gets when the desktop app shows it in a
// <webview> (Twitch and Kick only play when the page above them has a real web address, which
// the app's own window doesn't). It can send its player reports to the Glofly window, nothing
// else: no Node, no other Glofly functions, and only the main frame (never the site's player).
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('gloflyHost', {
  post: (msg: unknown): void => {
    if (!msg || typeof msg !== 'object') return
    try {
      // A plain copy: only data crosses (never functions or objects from the page).
      ipcRenderer.sendToHost('watch', JSON.parse(JSON.stringify(msg)))
    } catch {
      // not sendable: dropped
    }
  }
})
