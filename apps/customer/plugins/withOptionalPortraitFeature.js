const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Keep the portrait lock for the phone UI without using it to filter out
 * tablets, desktops, or Android XR devices in Google Play.
 */
module.exports = function withOptionalPortraitFeature(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest['uses-feature'] = manifest['uses-feature'] || [];
    const feature = manifest['uses-feature'].find((item) => item.$?.['android:name'] === 'android.hardware.screen.portrait');
    if (feature) feature.$['android:required'] = 'false';
    else manifest['uses-feature'].push({ $: { 'android:name': 'android.hardware.screen.portrait', 'android:required': 'false' } });
    return mod;
  });
};
