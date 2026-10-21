import Foundation

/// 0.8.0 "Share to Glofly" on iPhone and iPad: the app's side of the Share Extension
/// (plugins/share-extension/ShareViewController.swift, added to the Xcode project by
/// plugins/with-share-to-glofly.js).
///
/// The extension saves what was shared in the App Group both share (GloflyAppGroup in Info.plist):
/// `share/<id>/share.json` plus the files next to it, and `share/pending` naming the newest one.
/// It then opens glofly://share?id=<id>. Here the share is moved into the app's own caches (where
/// the uploader can read it) and handed to JavaScript in the same shape Android uses.
enum GloflyShareInbox {
  static var groupId: String? {
    Bundle.main.object(forInfoDictionaryKey: "GloflyAppGroup") as? String
  }

  private static func shareRoot() -> URL? {
    guard let groupId, let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId) else { return nil }
    return container.appendingPathComponent("share", isDirectory: true)
  }

  private static func cacheRoot() -> URL {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    return caches.appendingPathComponent("glofly-share", isDirectory: true)
  }

  private static func validId(_ id: String) -> Bool {
    id.range(of: "^[0-9A-Fa-f-]{36}$", options: .regularExpression) != nil
  }

  /// The share with this id (or the newest waiting one), once. Nil when there's none.
  static func take(_ wanted: String?) -> [String: Any]? {
    guard let root = shareRoot() else { return nil }
    let fm = FileManager.default
    let pendingFile = root.appendingPathComponent("pending")
    let pending = (try? String(contentsOf: pendingFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let id = (wanted?.isEmpty == false ? wanted : pending), validId(id) else { return nil }
    if pending == id { try? fm.removeItem(at: pendingFile) }
    let newer = pending == id ? nil : pending
    let folder = root.appendingPathComponent(id, isDirectory: true)
    let manifestURL = folder.appendingPathComponent("share.json")
    guard
      let data = try? Data(contentsOf: manifestURL),
      let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    // Taken: nobody else picks it up again. One share at a time: older ones (never opened) and
    // copies from earlier shares go now (no file dates needed, so no privacy-manifest reason).
    try? fm.removeItem(at: manifestURL)
    removeAll(in: root, except: Set([id, "pending", newer ?? ""]))
    removeAll(in: cacheRoot(), except: [id])

    let dest = cacheRoot().appendingPathComponent(id, isDirectory: true)
    try? fm.createDirectory(at: dest, withIntermediateDirectories: true)
    var files: [[String: Any]] = []
    for f in (manifest["files"] as? [[String: Any]]) ?? [] {
      let name = (f["name"] as? String) ?? "File"
      let mime = (f["mimeType"] as? String) ?? "application/octet-stream"
      // Plain Int (not Int64) so Expo hands it to JavaScript as a number.
      let size = (f["size"] as? NSNumber)?.intValue ?? 0
      if (f["tooBig"] as? Bool) == true {
        files.append(["name": name, "mimeType": mime, "size": size, "tooBig": true])
        continue
      }
      guard let file = f["file"] as? String, !file.contains("/"), !file.hasPrefix(".") else { continue }
      let from = folder.appendingPathComponent(file)
      let to = dest.appendingPathComponent(file)
      try? fm.removeItem(at: to)
      do {
        try fm.moveItem(at: from, to: to)
      } catch {
        do { try fm.copyItem(at: from, to: to) } catch { continue }
      }
      files.append(["uri": to.absoluteString, "name": name, "mimeType": mime, "size": size, "tooBig": false])
    }
    try? fm.removeItem(at: folder)
    let text = (manifest["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    if (text ?? "").isEmpty && files.isEmpty { return nil }
    var out: [String: Any] = [
      "id": id,
      "files": files,
      "skipped": (manifest["skipped"] as? NSNumber)?.intValue ?? 0,
    ]
    if let text, !text.isEmpty { out["text"] = text }
    return out
  }

  /// A share's copies, once it's sent or cancelled.
  static func discard(_ id: String) {
    guard validId(id) else { return }
    try? FileManager.default.removeItem(at: cacheRoot().appendingPathComponent(id, isDirectory: true))
  }

  private static func removeAll(in dir: URL, except keep: Set<String>) {
    let fm = FileManager.default
    guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
    for item in items where !keep.contains(item.lastPathComponent) {
      try? fm.removeItem(at: item)
    }
  }
}
