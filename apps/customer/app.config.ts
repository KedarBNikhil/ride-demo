const productionProjectId = '1158ff7e-1da5-4a6a-9080-14791394da7a';
const stagingProjectId = '27afc445-8b40-4df5-b574-ef52c4e36274';

const isStaging = process.env.SAWAARI_ENVIRONMENT === 'staging';
const projectId = isStaging ? stagingProjectId : productionProjectId;

export default {
  name: isStaging ? 'Sawaari Test' : 'Sawaari',
  slug: isStaging ? 'sawaari-test-customer' : 'nandyal-ride-customer',
  scheme: isStaging ? 'exp+sawaari-test-customer' : 'exp+nandyal-ride-customer',
  version: '1.0.6',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/images/sawaari-app-icon.png',
  splash: { resizeMode: 'contain', backgroundColor: '#FFFFFF' },
  assetBundlePatterns: ['**/*'],

  runtimeVersion: process.env.SAWAARI_UPDATE_RUNTIME_VERSION
    ?? (isStaging ? 'customer-staging-1.0.6' : 'customer-1.0.6'),

  updates: {
    url: `https://u.expo.dev/${projectId}`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: {
      'expo-channel-name': isStaging ? 'staging-customer' : 'production-customer',
    },
  },

  android: {
    package: isStaging
      ? 'com.nandyalride.customer.staging'
      : 'com.nandyalride.customer',
    versionCode: 8,
    googleServicesFile: isStaging
      ? './firebase/staging/google-services.json'
      : './firebase/google-services.json',
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CUSTOMER
          ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
          ?? '',
      },
    },
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      'POST_NOTIFICATIONS',
      'READ_CONTACTS',
    ],
  },

  ios: {
    bundleIdentifier: isStaging
      ? 'com.nandyalride.customer.staging'
      : 'com.nandyalride.customer',
    googleServicesFile: './firebase/GoogleService-Info.plist',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Nandyal Ride uses your location to set your pickup point and show ride progress.',
      NSContactsUsageDescription:
        'Nandyal Ride uses your contacts to let you add emergency contacts.',
    },
  },

  plugins: [
    './plugins/withAndroidCrashlytics',
    './plugins/withOptionalPortraitFeature',
    './plugins/withFirebaseStaticLinkage',
    './plugins/withIosSceneLifecycle',
    ['expo-notifications', {}],
    ['expo-location', {}],
    [
      'expo-contacts',
      {
        contactsPermission:
          'Allow Nandyal Ride to access your contacts so you can add emergency contacts.',
      },
    ],
  ],

  extra: {
    appMode: 'customer',
    appEnvironment: isStaging ? 'staging' : 'production',
    razorpayRideCheckoutEnabled:
      process.env.EXPO_PUBLIC_RAZORPAY_RIDE_CHECKOUT_ENABLED === 'true',
    eas: { projectId },
  },
};