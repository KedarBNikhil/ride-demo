const projectId = '1158ff7e-1da5-4a6a-9080-14791394da7a';

export default {
  name: 'Sawaari',
  slug: 'nandyal-ride-customer',
  scheme: 'exp+nandyal-ride-customer',
  version: '1.0.2',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/images/sawaari-app-icon.png',
  splash: { resizeMode: 'contain', backgroundColor: '#FFFFFF' },
  assetBundlePatterns: ['**/*'],
  runtimeVersion: 'customer-1.0.2',
  updates: {
    url: `https://u.expo.dev/${projectId}`,
    enabled: true,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
    requestHeaders: { 'expo-channel-name': 'production-customer' },
  },
  android: {
    package: 'com.nandyalride.customer',
    versionCode: 4,
    googleServicesFile: './firebase/google-services.json',
    config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_CUSTOMER ?? process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '' } },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS', 'READ_CONTACTS'],
  },
  ios: {
    bundleIdentifier: 'com.nandyalride.customer',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Nandyal Ride uses your location to set your pickup point and show ride progress.',
      NSContactsUsageDescription: 'Nandyal Ride uses your contacts to let you add emergency contacts.',
    },
  },
  plugins: [
    './plugins/withAndroidCrashlytics',
    ['expo-notifications', {}],
    ['expo-location', {}],
    ['expo-contacts', { contactsPermission: 'Allow Nandyal Ride to access your contacts so you can add emergency contacts.' }],
  ],
  extra: { appMode: 'customer', eas: { projectId } },
};
