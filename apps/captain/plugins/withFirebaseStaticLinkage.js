const { withPodfile } = require('@expo/config-plugins');

const setting = '$RNFirebaseDisableSPM = true';
const modularHeaders = [
  "  pod 'GoogleUtilities', :modular_headers => true",
  "  pod 'GoogleDataTransport', :modular_headers => true",
  "  pod 'nanopb', :modular_headers => true",
].join('\n');

/**
 * React Native Firebase's Swift Package Manager integration cannot be used
 * with static frameworks. Keep CocoaPods as the Firebase resolver so local
 * and EAS iOS builds use the same compatible setup.
 */
module.exports = function withFirebaseStaticLinkage(config) {
  return withPodfile(config, (mod) => {
    if (!mod.modResults.contents.includes(setting)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        'prepare_react_native_project!\n',
        `prepare_react_native_project!\n\n${setting}\n`,
      );
    }
    if (!mod.modResults.contents.includes("pod 'GoogleUtilities', :modular_headers => true")) {
      mod.modResults.contents = mod.modResults.contents.replace(
        '  use_expo_modules!\n',
        `  use_expo_modules!\n\n  # Firebase Swift pods need module maps when static frameworks are selected.\n${modularHeaders}\n`,
      );
    }
    const deploymentTargetMarker = "configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'";
    if (!mod.modResults.contents.includes(deploymentTargetMarker)) {
      const deploymentTargetBlock = [
        '    installer.pods_project.targets.each do |target|',
        '      target.build_configurations.each do |configuration|',
        `        ${deploymentTargetMarker}`,
        '      end',
        '    end',
        '',
      ].join('\n');
      mod.modResults.contents = mod.modResults.contents.replace(
        '  post_install do |installer|\n',
        `  post_install do |installer|\n${deploymentTargetBlock}`,
      );
    }
    return mod;
  });
};
