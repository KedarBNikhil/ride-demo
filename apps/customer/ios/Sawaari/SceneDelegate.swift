import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    // Expo creates its React Native window in AppDelegate. On recent iOS SDKs
    // the scene callback can arrive first, so attach it on the next main-loop
    // turn after Expo has completed that setup.
    DispatchQueue.main.async {
      guard let appDelegate = UIApplication.shared.delegate as? AppDelegate else { return }
      guard let appWindow = appDelegate.window else { return }
      appWindow.windowScene = windowScene
      self.window = appWindow
      appWindow.makeKeyAndVisible()
    }
  }
}
