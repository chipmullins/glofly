import UIKit

/// 0.8.0 keyboard shortcuts on iPad (and iPhone with a keyboard): ⌘K, ⌘/, ⌘N, ⌘F, ↑, Esc, ⌥↑, ⌥↓.
///
/// The app turns on only the commands it can do right now (`setKeyCommands`, from
/// src/lib/keys.ts); each one goes to JavaScript as a "keyCommand" event with its id. They're
/// UIKeyCommands with titles, so holding ⌘ shows them in iPadOS's shortcut overlay.
///
/// Where they live: on the window's root view controller, which is in the responder chain of
/// every screen (pushed and presented ones too) while a text box has focus, and the action is a
/// method on UIApplication (the end of every chain). When nothing has focus there is no chain at
/// all, so a small invisible view on the window takes focus then (`KeyCatcher`, which offers the
/// same commands); it shows no keyboard and gives focus up the moment a text box is tapped. It sits
/// on the window, not inside React Native's views, so React Native never sees it.
@MainActor
final class GloflyKeyCommands: NSObject {
  static let shared = GloflyKeyCommands()

  private struct Spec {
    let id: String
    let input: String
    let flags: UIKeyModifierFlags
    let title: String
    /// Keys a text box would otherwise use (arrows, Esc): ours only while the app says so.
    let overridesText: Bool
  }

  private static let all: [Spec] = [
    Spec(id: "quick", input: "k", flags: .command, title: "Find a chat, friend or constellation", overridesText: false),
    Spec(id: "shortcuts", input: "/", flags: .command, title: "Keyboard shortcuts", overridesText: false),
    Spec(id: "newMessage", input: "n", flags: .command, title: "New message", overridesText: false),
    Spec(id: "find", input: "f", flags: .command, title: "Search", overridesText: false),
    Spec(id: "editLast", input: UIKeyCommand.inputUpArrow, flags: [], title: "Edit your last message", overridesText: true),
    Spec(id: "escape", input: UIKeyCommand.inputEscape, flags: [], title: "Close", overridesText: true),
    Spec(id: "prevNebula", input: UIKeyCommand.inputUpArrow, flags: .alternate, title: "Previous nebula", overridesText: true),
    Spec(id: "nextNebula", input: UIKeyCommand.inputDownArrow, flags: .alternate, title: "Next nebula", overridesText: true),
  ]

  private var enabled: [String] = []
  /// The commands switched on now (also what KeyCatcher offers).
  private(set) var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?
  private var observing = false

  /// The commands the app can do right now (ids above); the others are left alone. From any thread.
  nonisolated static func set(_ ids: [String]) {
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        let me = GloflyKeyCommands.shared
        me.enabled = ids
        me.observe()
        me.install()
      }
    }
  }

  fileprivate func fire(_ command: UIKeyCommand) {
    guard let spec = Self.all.first(where: { $0.input == command.input && $0.flags == command.modifierFlags }) else { return }
    guard enabled.contains(spec.id) else { return }
    GloflyNativeModule.emit("keyCommand", ["id": spec.id])
  }

  private func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let ordered = scenes.filter { $0.activationState == .foregroundActive } + scenes.filter { $0.activationState != .foregroundActive }
    let windows = ordered.flatMap { $0.windows }
    return windows.first(where: { $0.isKeyWindow }) ?? windows.first
  }

  private func install() {
    guard let window = keyWindow(), let root = window.rootViewController else { return }
    if let old = host {
      for c in installed { old.removeKeyCommand(c) }
    }
    installed = []
    host = root
    for spec in Self.all where enabled.contains(spec.id) {
      let command = UIKeyCommand(
        title: spec.title,
        action: #selector(UIApplication.glofly_keyCommand(_:)),
        input: spec.input,
        modifierFlags: spec.flags
      )
      command.discoverabilityTitle = spec.title
      if spec.overridesText {
        // Our ↑ / Esc / ⌥↑ win over the text box's (only switched on while the box is empty,
        // a sheet is open, or a nebula is on screen).
        command.wantsPriorityOverSystemBehavior = true
      }
      root.addKeyCommand(command)
      installed.append(command)
    }
    KeyCatcher.shared.attach(to: window, active: !enabled.isEmpty)
  }

  private func observe() {
    if observing { return }
    observing = true
    let center = NotificationCenter.default
    // A new root (the app reloading) or coming back: put the commands on it again.
    for name in [UIApplication.didBecomeActiveNotification, UIWindow.didBecomeKeyNotification] {
      center.addObserver(forName: name, object: nil, queue: .main) { _ in
        MainActor.assumeIsolated { GloflyKeyCommands.shared.install() }
      }
    }
    // A text box let go of focus: nothing has focus now, so the catcher takes it.
    for name in [UITextField.textDidEndEditingNotification, UITextView.textDidEndEditingNotification, UIResponder.keyboardDidHideNotification] {
      center.addObserver(forName: name, object: nil, queue: .main) { _ in
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
          MainActor.assumeIsolated { KeyCatcher.shared.takeFocusIfFree() }
        }
      }
    }
  }
}

/// The invisible view that holds focus while nothing else does, so the commands keep working.
final class KeyCatcher: UIView {
  static let shared = KeyCatcher(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
  private var active = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    alpha = 0
  }

  required init?(coder: NSCoder) { fatalError("not used") }

  override var canBecomeFirstResponder: Bool { active }

  override var keyCommands: [UIKeyCommand]? { active ? GloflyKeyCommands.shared.installed : nil }

  func attach(to view: UIWindow?, active: Bool) {
    self.active = active
    guard let view else { return }
    if superview !== view {
      removeFromSuperview()
      view.addSubview(self)
    }
    if active {
      takeFocusIfFree()
    } else if isFirstResponder {
      resignFirstResponder()
    }
  }

  func takeFocusIfFree() {
    guard active, window != nil, !isFirstResponder else { return }
    if FirstResponder.current() == nil { becomeFirstResponder() }
  }
}

/// Finds whatever has focus now (nil when nothing does).
@MainActor
private enum FirstResponder {
  static weak var found: UIResponder? = nil

  static func current() -> UIResponder? {
    found = nil
    UIApplication.shared.sendAction(#selector(UIResponder.glofly_reportFirstResponder(_:)), to: nil, from: nil, for: nil)
    // With nothing focused the action ends up at the application itself: that isn't focus.
    guard let r = found, r.isFirstResponder else { return nil }
    return r
  }

  static func report(_ r: UIResponder) { found = r }
}

extension UIResponder {
  @objc func glofly_reportFirstResponder(_ sender: Any?) {
    FirstResponder.report(self)
  }
}

extension UIApplication {
  /// Every Glofly key command lands here (UIApplication ends every responder chain).
  @objc func glofly_keyCommand(_ sender: UIKeyCommand) {
    GloflyKeyCommands.shared.fire(sender)
  }
}
