import ImageIO
import UIKit
import UniformTypeIdentifiers

/// "Share to Glofly" (0.8.0): the Share Extension that shows up in iOS's share sheet.
///
/// It doesn't sign in or send anything itself. It saves what was shared (photos as JPEG or PNG,
/// videos, files, a link or text) in the App Group Glofly shares with it, then opens Glofly at
/// glofly://share?id=<id>, where the "Send to…" screen picks a chat, group or nebula and sends it
/// with Glofly's own upload code. The app's side is modules/glofly-native/ios/Share.swift.
///
/// Folder layout (in the App Group): share/<id>/share.json + the files, share/pending = <id>.
final class ShareViewController: UIViewController {
  private let groupId = (Bundle.main.object(forInfoDictionaryKey: "GloflyAppGroup") as? String) ?? ""
  private let scheme = (Bundle.main.object(forInfoDictionaryKey: "GloflyScheme") as? String) ?? "glofly"

  private var started = false
  private let card = UIView()
  private let spinner = UIActivityIndicatorView(style: .medium)
  private let label = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.25)
    card.backgroundColor = .secondarySystemBackground
    card.layer.cornerRadius = 18
    card.translatesAutoresizingMaskIntoConstraints = false
    spinner.translatesAutoresizingMaskIntoConstraints = false
    spinner.startAnimating()
    label.translatesAutoresizingMaskIntoConstraints = false
    label.text = "Opening Glofly…"
    label.font = .preferredFont(forTextStyle: .headline)
    label.textAlignment = .center
    label.numberOfLines = 0
    view.addSubview(card)
    card.addSubview(spinner)
    card.addSubview(label)
    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      card.widthAnchor.constraint(equalToConstant: 260),
      spinner.topAnchor.constraint(equalTo: card.topAnchor, constant: 22),
      spinner.centerXAnchor.constraint(equalTo: card.centerXAnchor),
      label.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 12),
      label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
      label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
      label.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if started { return }
    started = true
    Task { await self.run() }
  }

  // MARK: - Saving the share

  private func shareRoot() -> URL? {
    guard !groupId.isEmpty, let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId) else { return nil }
    return container.appendingPathComponent("share", isDirectory: true)
  }

  private func run() async {
    guard let root = shareRoot() else {
      return finish(message: "Open Glofly once, then try sharing again.")
    }
    let id = UUID().uuidString
    let folder = root.appendingPathComponent(id, isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      return finish(message: "Glofly couldn't save that. Try again.")
    }
    var texts: [String] = []
    var files: [Saved] = []
    var skipped = 0
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    for item in items {
      for provider in item.attachments ?? [] {
        if files.count >= ShareFiles.maxFiles && isFileLike(provider) {
          skipped += 1
          continue
        }
        switch await take(provider, into: folder) {
        case .file(let saved): files.append(saved)
        case .text(let t): if !texts.contains(t) { texts.append(t) }
        case .none: skipped += 1
        }
      }
    }
    // Some apps send their text only as the item's content text.
    if texts.isEmpty && files.isEmpty {
      for item in items {
        if let t = item.attributedContentText?.string.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty { texts.append(t) }
      }
    }
    if texts.isEmpty && files.isEmpty {
      try? FileManager.default.removeItem(at: folder)
      return finish(message: "Glofly can't send that kind of item.")
    }
    let manifest: [String: Any] = [
      "text": texts.joined(separator: "\n"),
      "skipped": skipped,
      "files": files.map { f -> [String: Any] in
        var o: [String: Any] = ["name": f.name, "mimeType": f.mimeType, "size": f.size, "tooBig": f.tooBig]
        if let file = f.file { o["file"] = file }
        return o
      },
    ]
    do {
      let data = try JSONSerialization.data(withJSONObject: manifest)
      try data.write(to: folder.appendingPathComponent("share.json"), options: .atomic)
      try id.write(to: root.appendingPathComponent("pending"), atomically: true, encoding: .utf8)
    } catch {
      try? FileManager.default.removeItem(at: folder)
      return finish(message: "Glofly couldn't save that. Try again.")
    }
    openGlofly(id: id)
  }


  private func isFileLike(_ p: NSItemProvider) -> Bool {
    p.hasItemConformingToTypeIdentifier(UTType.image.identifier)
      || p.hasItemConformingToTypeIdentifier(UTType.movie.identifier)
      || p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier)
  }

  private func take(_ p: NSItemProvider, into folder: URL) async -> Taken {
    if p.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
      if let saved = await ShareFiles.image(p, into: folder) { return .file(saved) }
    }
    if p.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
      if let saved = await ShareFiles.fileCopy(p, type: UTType.movie, into: folder) { return .file(saved) }
    }
    // A web link (a file's address is a file, below).
    if p.hasItemConformingToTypeIdentifier(UTType.url.identifier) && !p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
      if let url = try? await p.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, !url.isFileURL {
        return .text(url.absoluteString)
      }
    }
    if p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      let item = try? await p.loadItem(forTypeIdentifier: UTType.plainText.identifier)
      if let s = item as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return .text(s.trimmingCharacters(in: .whitespacesAndNewlines))
      }
      if let d = item as? Data, let s = String(data: d, encoding: .utf8), !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return .text(s.trimmingCharacters(in: .whitespacesAndNewlines))
      }
    }
    if p.hasItemConformingToTypeIdentifier(UTType.data.identifier) {
      if let saved = await ShareFiles.fileCopy(p, type: UTType.data, into: folder) { return .file(saved) }
    }
    return .none
  }

  // MARK: - Handing over to Glofly

  private func openGlofly(id: String) {
    guard let url = URL(string: "\(scheme)://share?id=\(id)") else { return finish(message: nil) }
    // Share extensions can't open apps directly; the app object at the end of the responder
    // chain can (the way every "open in" share extension does it).
    var responder: UIResponder? = self
    while let r = responder {
      if let app = r as? UIApplication {
        app.open(url, options: [:]) { ok in
          if ok {
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
          } else {
            self.finish(message: "Saved. Open Glofly to choose where to send it.")
          }
        }
        return
      }
      responder = r.next
    }
    finish(message: "Saved. Open Glofly to choose where to send it.")
  }

  /// Done: with a short note first when something needs saying.
  private func finish(message: String?) {
    DispatchQueue.main.async {
      guard let message else {
        self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        return
      }
      self.spinner.stopAnimating()
      self.spinner.isHidden = true
      self.label.text = message
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
        self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
      }
    }
  }
}

struct Saved {
  var file: String?
  var name: String
  var mimeType: String
  var size: Int64
  var tooBig: Bool
}

enum Taken {
  case file(Saved)
  case text(String)
  case none
}

/// Saving shared files (no UI: runs on whatever thread iOS hands the files over on).
enum ShareFiles {
  /// Glofly sends up to 10 attachments in a message.
  static let maxFiles = 10
  /// Bigger than anything Glofly accepts (videos 64 MB): left out and named in the app instead.
  static let maxBytes: Int64 = 80 * 1024 * 1024
  /// Photos larger than this (on the long side) are scaled down while turning them into JPEGs.
  static let maxPixels = 4096

  /// Copies the provider's file into the folder (inside the callback: iOS deletes it afterwards).
  static func fileCopy(_ p: NSItemProvider, type: UTType, into folder: URL) async -> Saved? {
    await withCheckedContinuation { (done: CheckedContinuation<Saved?, Never>) in
      _ = p.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        guard let url else { return done.resume(returning: nil) }
        let name = displayName(p.suggestedName, url: url, fallback: type.conforms(to: .movie) ? "Video" : "File")
        let mime = mimeType(for: url, fallback: type.conforms(to: .movie) ? "video/mp4" : "application/octet-stream")
        let size = fileSize(url)
        if size > maxBytes {
          return done.resume(returning: Saved(file: nil, name: name, mimeType: mime, size: size, tooBig: true))
        }
        let file = UUID().uuidString + "." + (url.pathExtension.isEmpty ? "bin" : url.pathExtension.lowercased())
        do {
          try FileManager.default.copyItem(at: url, to: folder.appendingPathComponent(file))
          done.resume(returning: Saved(file: file, name: name, mimeType: mime, size: size, tooBig: false))
        } catch {
          done.resume(returning: nil)
        }
      }
    }
  }

  /// Photos: JPEG, PNG and GIF go as they are; anything else (HEIC from the camera) becomes a JPEG
  /// every phone and computer can show. Screenshots handed over as pictures are saved as PNG.
  static func image(_ p: NSItemProvider, into folder: URL) async -> Saved? {
    let fromFile: Saved? = await withCheckedContinuation { (done: CheckedContinuation<Saved?, Never>) in
      _ = p.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, _ in
        guard let url else { return done.resume(returning: nil) }
        done.resume(returning: saveImageFile(url, suggested: p.suggestedName, into: folder))
      }
    }
    if let fromFile { return fromFile }
    // Some apps only hand over the picture itself.
    guard let item = try? await p.loadItem(forTypeIdentifier: UTType.image.identifier) else { return nil }
    var picture: UIImage?
    if let i = item as? UIImage { picture = i }
    if let d = item as? Data { picture = UIImage(data: d) }
    if let u = item as? URL { return saveImageFile(u, suggested: p.suggestedName, into: folder) }
    guard let png = picture?.pngData() else { return nil }
    let file = UUID().uuidString + ".png"
    do {
      try png.write(to: folder.appendingPathComponent(file))
    } catch {
      return nil
    }
    let name = displayName(p.suggestedName, url: nil, fallback: "Photo", ext: "png")
    return Saved(file: file, name: name, mimeType: "image/png", size: Int64(png.count), tooBig: false)
  }

  static func saveImageFile(_ url: URL, suggested: String?, into folder: URL) -> Saved? {
    let type = UTType(filenameExtension: url.pathExtension)
    let keep: [UTType] = [.jpeg, .png, .gif]
    if let type, keep.contains(where: { type.conforms(to: $0) }) {
      let size = fileSize(url)
      let name = displayName(suggested, url: url, fallback: "Photo")
      let mime = type.preferredMIMEType ?? "image/jpeg"
      if size > maxBytes { return Saved(file: nil, name: name, mimeType: mime, size: size, tooBig: true) }
      let file = UUID().uuidString + "." + url.pathExtension.lowercased()
      do {
        try FileManager.default.copyItem(at: url, to: folder.appendingPathComponent(file))
      } catch {
        return nil
      }
      return Saved(file: file, name: name, mimeType: mime, size: size, tooBig: false)
    }
    // Turn it into a JPEG, upright and at most maxPixels on the long side (without decoding a
    // 48-megapixel photo whole: share extensions have little memory).
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let file = UUID().uuidString + ".jpg"
    let out = folder.appendingPathComponent(file)
    guard let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, cg, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(dest) else { return nil }
    let name = displayName(suggested, url: url, fallback: "Photo", ext: "jpg")
    return Saved(file: file, name: name, mimeType: "image/jpeg", size: fileSize(out), tooBig: false)
  }


  // Names and types
  static func displayName(_ suggested: String?, url: URL?, fallback: String, ext: String? = nil) -> String {
    var base = (suggested?.isEmpty == false ? suggested! : (url?.deletingPathExtension().lastPathComponent ?? ""))
    base = base.replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespacesAndNewlines)
    if base.isEmpty { base = fallback }
    // A suggested name may already end in its extension.
    if let e = ext ?? url?.pathExtension.lowercased(), !e.isEmpty {
      let stem = (base as NSString).deletingPathExtension
      return String((stem.isEmpty ? base : stem).prefix(100)) + "." + e
    }
    return String(base.prefix(110))
  }

  static func mimeType(for url: URL, fallback: String) -> String {
    UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? fallback
  }

  static func fileSize(_ url: URL) -> Int64 {
    Int64((try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
  }
}
