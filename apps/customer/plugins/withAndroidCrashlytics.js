const { withAppBuildGradle, withProjectBuildGradle } = require('@expo/config-plugins');

const crashlyticsClasspath = "classpath 'com.google.firebase:firebase-crashlytics-gradle:3.0.8'";
const crashlyticsPlugin = "apply plugin: 'com.google.firebase.crashlytics'";

/** Android-only: the official cross-platform plugin requires an iOS plist. */
module.exports = function withAndroidCrashlytics(config) {
  config = withProjectBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(crashlyticsClasspath)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        "classpath 'com.google.gms:google-services:4.4.1'",
        "classpath 'com.google.gms:google-services:4.4.1'\n        " + crashlyticsClasspath,
      );
    }
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(crashlyticsPlugin)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        "apply plugin: 'com.google.gms.google-services'",
        "apply plugin: 'com.google.gms.google-services'\n" + crashlyticsPlugin,
      );
    }
    return mod;
  });
};
