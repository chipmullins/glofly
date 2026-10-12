import Foundation
import Security
import UIKit
import UserNotifications

/// What notification buttons (Reply, Mark as read, Decline) need to reach the Glofly server
/// without the app open. Kept in the Keychain (it holds the session token), readable after the
/// phone's first unlock so actions work from the lock screen. Removed when signing out.
struct PushConfig: Codable {
  let serverUrl: String
  let token: String
  let version: String
  let platform: String
  let meId: String
}

enum PushStore {
  private static let service = "app.glofly.push"
  private static let account = "config"

  private static var base: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  static func save(_ config: PushConfig) {
    guard let data = try? JSONEncoder().encode(config) else { return }
    SecItemDelete(base as CFDictionary)
    var add = base
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(add as CFDictionary, nil)
  }

  static func load() -> PushConfig? {
    var query = base
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return try? JSONDecoder().decode(PushConfig.self, from: data)
  }

  static func clear() {
    SecItemDelete(base as CFDictionary)
  }
}

/// Small calls to the Glofly server from native code (replies, mark as read, declining a call).
enum GloflyHttp {
  static func send(_ c: PushConfig, _ method: String, _ path: String, json: [String: Any]? = nil, done: @escaping (Int) -> Void) {
    guard let url = URL(string: c.serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else { return done(-1) }
    var req = URLRequest(url: url, timeoutInterval: 10)
    req.httpMethod = method
    req.setValue("Bearer \(c.token)", forHTTPHeaderField: "Authorization")
    req.setValue(c.version, forHTTPHeaderField: "X-Glofly-Version")
    req.setValue(c.platform, forHTTPHeaderField: "X-Glofly-Platform")
    if let json, let body = try? JSONSerialization.data(withJSONObject: json) {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = body
    }
    URLSession.shared.dataTask(with: req) { _, res, _ in
      done((res as? HTTPURLResponse)?.statusCode ?? -1)
    }.resume()
  }
}

/// Notifications on the iPhone. The server sends ready-made notifications (iOS shows them itself,
/// even while Glofly is closed); this handles what happens around them: the buttons, opening the
/// right screen when one is tapped, and removing ones that were read or answered elsewhere.
final class GloflyNotifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = GloflyNotifications()

  static let messageCategory = "GLOFLY_MESSAGE"
  static let callCategory = "GLOFLY_CALL"
  private static let replyAction = "REPLY"
  private static let readAction = "READ"
  private static let declineAction = "DECLINE"
  private static let answerAction = "ANSWER"

  /// A link from a tapped notification that waits until the app's screens are up.
  private var pendingLink: String?
  var appReady = false

  func install() {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    let reply = UNTextInputNotificationAction(identifier: Self.replyAction, title: "Reply", options: [], textInputButtonTitle: "Send", textInputPlaceholder: "Message")
    let read = UNNotificationAction(identifier: Self.readAction, title: "Mark as read", options: [])
    let answer = UNNotificationAction(identifier: Self.answerAction, title: "Answer", options: [.foreground])
    let decline = UNNotificationAction(identifier: Self.declineAction, title: "Decline", options: [.destructive])
    center.setNotificationCategories([
      UNNotificationCategory(identifier: Self.messageCategory, actions: [reply, read], intentIdentifiers: [], options: []),
      UNNotificationCategory(identifier: Self.callCategory, actions: [answer, decline], intentIdentifiers: [], options: []),
    ])
  }

  /// The link the app should open (if a notification was tapped before the app was ready).
  func takePendingLink() -> String? {
    appReady = true
    defer { pendingLink = nil }
    return pendingLink
  }

  private func open(_ link: String) {
    DispatchQueue.main.async {
      if self.appReady, let url = URL(string: link) {
        UIApplication.shared.open(url)
      } else {
        self.pendingLink = link
      }
    }
  }

  static func link(for info: [AnyHashable: Any]) -> String? {
    let type = info["type"] as? String
    let conversationId = (info["conversationId"] as? String) ?? ""
    switch type {
    case "message", "call_missed":
      return conversationId.isEmpty ? nil : "glofly://chat/\(conversationId)"
    case "friend_request":
      return "glofly://friends"
    case "call_ring":
      guard let callId = info["callId"] as? String else { return nil }
      return "glofly://incoming/\(callId)?chat=\(conversationId)&video=\((info["video"] as? String) ?? "0")"
    default:
      return nil
    }
  }

  // While Glofly is open the server doesn't push (the app gets everything live), so anything
  // arriving now is shown as usual; a ringing call also tells the app straight away.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    let info = notification.request.content.userInfo
    if info["type"] as? String == "call_ring", let callId = info["callId"] as? String {
      GloflyNativeModule.emit("callRing", ["callId": callId])
    }
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    let info = response.notification.request.content.userInfo
    let conversationId = (info["conversationId"] as? String) ?? ""
    let callId = (info["callId"] as? String) ?? ""
    let config = PushStore.load()
    switch response.actionIdentifier {
    case Self.replyAction:
      let text = ((response as? UNTextInputNotificationResponse)?.userText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      guard let config, !conversationId.isEmpty, !text.isEmpty else { return completionHandler() }
      // The server marks the chat read when you send, and clears it on your other devices.
      GloflyHttp.send(config, "POST", "/conversations/\(conversationId)/messages", json: ["body": String(text.prefix(4000))]) { status in
        if (200...299).contains(status) {
          Self.removeChat(conversationId)
        } else {
          Self.showLocal(title: "Couldn't send your reply", body: "Open Glofly to try again.", conversationId: conversationId)
        }
        completionHandler()
      }
    case Self.readAction:
      Self.removeChat(conversationId)
      guard let config, !conversationId.isEmpty else { return completionHandler() }
      GloflyHttp.send(config, "POST", "/conversations/\(conversationId)/read") { _ in completionHandler() }
    case Self.declineAction:
      Self.removeCall(callId)
      guard let config, !callId.isEmpty else { return completionHandler() }
      GloflyHttp.send(config, "POST", "/calls/\(callId)/decline") { _ in completionHandler() }
    case UNNotificationDismissActionIdentifier:
      completionHandler()
    default:
      // Tapped (or Answer): open that chat, Friends, or the incoming-call screen.
      if let link = Self.link(for: info) { open(link) }
      completionHandler()
    }
  }

  /// A silent push: a chat was read elsewhere, or a call stopped ringing.
  func handleBackground(_ info: [AnyHashable: Any]) {
    switch info["type"] as? String {
    case "clear":
      if let id = info["conversationId"] as? String { Self.removeChat(id) }
    case "call_stop", "call_missed":
      if let id = info["callId"] as? String { Self.removeCall(id) }
    default:
      break
    }
  }

  static func removeChat(_ conversationId: String) {
    guard !conversationId.isEmpty else { return }
    let center = UNUserNotificationCenter.current()
    center.getDeliveredNotifications { list in
      let ids = list.filter {
        let info = $0.request.content.userInfo
        return (info["conversationId"] as? String) == conversationId && (info["type"] as? String) != "call_ring"
      }.map { $0.request.identifier }
      center.removeDeliveredNotifications(withIdentifiers: ids)
    }
  }

  static func removeCall(_ callId: String) {
    guard !callId.isEmpty else { return }
    let center = UNUserNotificationCenter.current()
    center.getDeliveredNotifications { list in
      let ids = list.filter {
        let info = $0.request.content.userInfo
        return (info["callId"] as? String) == callId && (info["type"] as? String) == "call_ring"
      }.map { $0.request.identifier }
      center.removeDeliveredNotifications(withIdentifiers: ids + [callId])
    }
  }

  static func showLocal(title: String, body: String, conversationId: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.threadIdentifier = conversationId
    content.userInfo = ["type": "message", "conversationId": conversationId]
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
  }
}
