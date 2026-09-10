const projectId = '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13';

export default {
  name: 'Sawaari Captain',
  slug: 'nandyal-ride-captain',
  scheme: 'exp+nandyal-ride-captain',
  version: '1.0.4',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/images/sawaari-captain-google-play-icon-512.png',
  splash: { resizeMode: 'contain', backgroundColor: '#FFFFFF' },
  assetBundlePatterns: ['**/*'],
  runtimeVersion: 'captain-1.0.4',
  updates: {
    url: `https://u.expo.dev/${projectId}`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: { 'expo-channel-name': 'production-captain' },
  },
  android: {
    package: 'com.nandyalride.captain',
    versionCode: 5,
    googleServicesFile: './firebase/google-services.json',
    config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CAPTAIN ?? '' } },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS'],
  },
  ios: {
    bundleIdentifier: 'com.nandyalride.captain',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Sawaari Captain uses your location to operate rides and show active ride progress.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'Sawaari Captain uses your location only during an active ride for ride tracking and fraud verification.',
      NSCameraUsageDescription: 'Nandyal Ride Captain uses your camera to capture captain documents.',
      NSPhotoLibraryUsageDescription: 'Nandyal Ride Captain lets you select document photos from your library.',
    },
  },
  plugins: [
    './plugins/withAndroidCrashlytics',
    './plugins/withCaptainOfferAlert',
    ['expo-notifications', { sounds: ['./assets/sounds/incoming_ride_alert.mp3'] }],
    ['expo-audio', { recordAudioAndroid: false }],
    ['expo-location', {
      locationWhenInUsePermission: 'Sawaari Captain uses your location to operate rides and show active ride progress.',
      locationAlwaysAndWhenInUsePermission: 'Sawaari Captain uses your location only during an active ride for ride tracking and fraud verification.',
      isAndroidBackgroundLocationEnabled: true,
      isAndroidForegroundServiceEnabled: true,
      isIosBackgroundLocationEnabled: true,
    }],
    ['expo-image-picker', { cameraPermission: 'Allow Nandyal Ride Captain to use your camera for documents.', photosPermission: 'Allow Nandyal Ride Captain to access document photos.' }],
  ],
  extra: { appMode: 'captain', eas: { projectId } },
};
