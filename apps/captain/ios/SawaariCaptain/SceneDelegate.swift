import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }

    DispatchQueue.main.async {
      guard let appDelegate = UIApplication.shared.delegate as? AppDelegate,
            let appWindow = appDelegate.window else {
        return
      }

      appWindow.windowScene = windowScene
      self.window = appWindow
      appWindow.makeKeyAndVisible()
    }
  }
}
