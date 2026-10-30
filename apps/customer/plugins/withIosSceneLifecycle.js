const fs = require('fs');
const path = require('path');
const { IOSConfig, withAppDelegate, withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');

const sceneDelegateSource = `import UIKit

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
`;

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
        }],
      },
    };
    return mod;
  });

  config = withAppDelegate(config, (mod) => {
    const legacyStartup = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;
    const sceneStartup = `#if os(iOS) || os(tvOS)
    // The SceneDelegate creates the scene-owned window and starts React Native.
#endif
`;
    if (mod.modResults.contents.includes(sceneStartup)) {
      mod.modResults.contents = mod.modResults.contents.replace(sceneStartup, legacyStartup);
    }
    mod.modResults.contents = mod.modResults.contents.replace(
      /\n  func startReactNative\(in window: UIWindow\) \{[\s\S]*?\n  \}\n(?=\n  \/\/ Linking API)/,
      '',
    );
    return mod;
  });

  config = withDangerousMod(config, ['ios', (mod) => {
    const sourceRoot = IOSConfig.Paths.getSourceRoot(mod.modRequest.projectRoot);
    fs.writeFileSync(path.join(sourceRoot, 'SceneDelegate.swift'), sceneDelegateSource);
    return mod;
  }]);

  return withXcodeProject(config, (mod) => {
    const projectName = mod.modRequest.projectName;
    const filepath = `${projectName}/SceneDelegate.swift`;
    if (!mod.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: projectName, project: mod.modResults });
    }
    return mod;
  });
};
