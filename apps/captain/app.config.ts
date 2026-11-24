const productionProjectId = '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13';
const stagingProjectId = 'e887f7be-4897-4433-be38-48401a3b223f';

const isStaging = process.env.SAWAARI_ENVIRONMENT === 'staging';
const projectId = isStaging ? stagingProjectId : productionProjectId;

export default {
  name: isStaging ? 'Sawaari Captain Test' : 'Sawaari Captain',
  slug: isStaging ? 'sawaari-test-captain' : 'nandyal-ride-captain',
  scheme: isStaging ? 'exp+sawaari-test-captain' : 'exp+nandyal-ride-captain',
  version: '1.0.10',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/images/sawaari-captain-google-play-icon-512.png',
  splash: { resizeMode: 'contain', backgroundColor: '#FFFFFF' },
  assetBundlePatterns: ['**/*'],

  runtimeVersion: process.env.SAWAARI_UPDATE_RUNTIME_VERSION
    ?? (isStaging ? 'captain-staging-1.0.10' : 'captain-1.0.10'),

  updates: {
    url: `https://u.expo.dev/${projectId}`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: {
      'expo-channel-name': isStaging ? 'staging-captain' : 'production-captain',
    },
  },

  android: {
    package: isStaging
      ? 'com.nandyalride.captain.staging'
      : 'com.nandyalride.captain',
    versionCode: 11,
    googleServicesFile: isStaging
      ? './firebase/staging/google-services.json'
      : './firebase/google-services.json',
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CAPTAIN ?? '',
      },
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'FOREGROUND_SERVICE',
      'FOREGROUND_SERVICE_LOCATION',
      'CAMERA',
      'POST_NOTIFICATIONS',
      'SYSTEM_ALERT_WINDOW',
    ],
  },

  ios: {
    bundleIdentifier: isStaging
      ? 'com.nandyalride.captain.staging'
      : 'com.nandyalride.captain',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Sawaari Captain uses your location to operate rides and show active ride progress.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Sawaari Captain uses your location only during an active ride for ride tracking and fraud verification.',
      NSCameraUsageDescription:
        'Nandyal Ride Captain uses your camera to capture captain documents.',
      NSPhotoLibraryUsageDescription:
        'Nandyal Ride Captain lets you select document photos from your library.',
    },
  },

  plugins: [
    './plugins/withAndroidCrashlytics',
    './plugins/withFirebaseStaticLinkage',
    './plugins/withCaptainOfferAlert',
    'expo-asset',
    ['expo-notifications', { sounds: ['./assets/sounds/incoming_ride_alert.mp3'] }],
    ['expo-audio', { recordAudioAndroid: false }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Sawaari Captain uses your location to operate rides and show active ride progress.',
        locationAlwaysAndWhenInUsePermission:
          'Sawaari Captain uses your location only during an active ride for ride tracking and fraud verification.',
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        cameraPermission:
          'Allow Nandyal Ride Captain to use your camera for documents.',
        photosPermission:
          'Allow Nandyal Ride Captain to access document photos.',
      },
    ],
  ],

  extra: {
    appMode: 'captain',
    appEnvironment: isStaging ? 'staging' : 'production',
    eas: { projectId },
  },
};
