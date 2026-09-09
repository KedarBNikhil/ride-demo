const appVariant = process.env.APP_VARIANT;
const publicAppMode = process.env.EXPO_PUBLIC_APP_MODE;

// A release command must state both identities. Choosing Customer when either
// value is absent can produce a Customer bundle from an intended Captain
// release (or the reverse when Metro reuses public environment replacements).
if (!appVariant || !publicAppMode) {
  throw new Error('APP_VARIANT and EXPO_PUBLIC_APP_MODE must both be set explicitly.');
}
if (appVariant !== publicAppMode) {
  throw new Error(`APP_VARIANT (${appVariant}) must match EXPO_PUBLIC_APP_MODE (${publicAppMode}).`);
}

const configuredVariant = appVariant;
if (configuredVariant !== 'customer' && configuredVariant !== 'captain' && configuredVariant !== 'chooser') {
  throw new Error('APP_VARIANT must be customer, captain, or chooser.');
}

const variant = configuredVariant;
const isCaptain = variant === 'captain';
const isChooser = variant === 'chooser';
const name = isCaptain ? 'Sawaari Captain' : isChooser ? 'Nandyal Ride Demo' : 'Sawaari';
const slug = isCaptain ? 'nandyal-ride-captain' : isChooser ? 'nandyal-ride-demo' : 'nandyal-ride-customer';
const scheme = isCaptain ? 'exp+nandyal-ride-captain' : isChooser ? 'exp+nandyal-ride-demo' : 'exp+nandyal-ride-customer';
// Captain 1.0.3 introduces TaskManager-backed background GPS and new native
// permissions. Older binaries must not receive this JavaScript bundle by OTA.
const version = isCaptain ? '1.0.3' : isChooser ? '1.0.0' : '1.0.2';
const androidPackage = isCaptain ? 'com.nandyalride.captain' : isChooser ? 'com.nandyalride.demo' : 'com.nandyalride.customer';
const androidVersionCode = isCaptain ? 4 : isChooser ? 1 : 4;
const iosBundleIdentifier = isCaptain ? 'com.nandyalride.captain' : isChooser ? 'com.nandyalride.demo' : 'com.nandyalride.customer';
const easProjectId = isCaptain
  ? '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13'
  : '1158ff7e-1da5-4a6a-9080-14791394da7a';
const googleServicesFile = isCaptain ? './firebase/nandyalride-captain.json' : './firebase/nandyalride-customer.json';
const icon = isCaptain ? './assets/images/sawaari-captain-google-play-icon-512.png' : './assets/images/sawaari-app-icon.png';
const googleMapsApiKey = isCaptain
  ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CAPTAIN
  : process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CUSTOMER ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

// Android Maps reads this at native-build time. `.env.local` is intentionally
// ignored, so an EAS build needs the key configured in its build environment.
// Failing here prevents a Captain APK with a permanently blank map.
if (process.env.EAS_BUILD === 'true' && !googleMapsApiKey) {
  throw new Error(`A Google Maps API key must be set for the ${variant} EAS build.`);
}

const config = {
  name, slug, scheme, version, orientation: 'portrait', userInterfaceStyle: 'light',
  icon,
  splash: { resizeMode: 'contain', backgroundColor: '#FFFFFF' }, assetBundlePatterns: ['**/*'],
  updates: {
    url: `https://u.expo.dev/${easProjectId}`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: version,
  android: {
    package: androidPackage,
    versionCode: androidVersionCode,
    googleServicesFile,
    config: { googleMaps: { apiKey: googleMapsApiKey ?? '' } },
    permissions: isCaptain ? ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS'] : ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS', 'READ_CONTACTS'],
  },
  ios: {
    bundleIdentifier: iosBundleIdentifier,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Nandyal Ride uses your location to set your pickup point and show ride progress.',
      ...(isCaptain ? {
        NSLocationWhenInUseUsageDescription: 'Sawaari Captain uses your location to operate rides and show active ride progress.',
        NSLocationAlwaysAndWhenInUseUsageDescription: 'Sawaari Captain uses your location only during an active ride for ride tracking and fraud verification.',
        NSCameraUsageDescription: 'Nandyal Ride Captain uses your camera to capture captain documents.',
        NSPhotoLibraryUsageDescription: 'Nandyal Ride Captain lets you select document photos from your library.',
      } : {
        NSContactsUsageDescription: 'Nandyal Ride uses your contacts to let you add emergency contacts.',
      }),
    },
  },
  plugins: [
    ['expo-notifications', {
      // This is copied into Android native resources at build time and is used
      // by the Captain's incoming-offer notification channel.
      ...(isCaptain ? { sounds: ['./assets/sounds/incoming_ride_alert.mp3'] } : {}),
    }],
    // Foreground-only looping dispatch alert. When suspended, Android's
    // notification channel receives the server-driven alert loop instead.
    ...(isCaptain ? [['expo-audio', { recordAudioAndroid: false }]] : []),
    ['expo-location', isCaptain ? {
      locationWhenInUsePermission: 'Sawaari Captain uses your location to operate rides and show active ride progress.',
      locationAlwaysAndWhenInUsePermission: 'Sawaari Captain uses your location only during an active ride for ride tracking and fraud verification.',
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true,
      isIosBackgroundLocationEnabled: true,
    } : {}],
    ...(isCaptain ? [] : [['expo-contacts', { contactsPermission: 'Allow Nandyal Ride to access your contacts so you can add emergency contacts.' }]]),
    ...(isCaptain ? [['expo-image-picker', { cameraPermission: 'Allow Nandyal Ride Captain to use your camera for documents.', photosPermission: 'Allow Nandyal Ride Captain to access document photos.' }]] : []),
  ],
  extra: {
    appMode: variant,
    // Public EAS project identifiers. Each independently installed app has its
    // own EAS project because it also has a distinct Android package identifier.
    eas: {
      projectId: easProjectId,
    },
  },
};
export default config;
