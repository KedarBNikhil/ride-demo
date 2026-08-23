import type { ExpoConfig } from 'expo/config';

type AppVariant = 'customer' | 'captain' | 'chooser';

const configuredVariant = process.env.APP_VARIANT ?? process.env.EXPO_PUBLIC_APP_MODE ?? 'customer';
if (configuredVariant !== 'customer' && configuredVariant !== 'captain' && configuredVariant !== 'chooser') {
  throw new Error('APP_VARIANT must be customer, captain, or chooser.');
}

const variant: AppVariant = configuredVariant;
const isCaptain = variant === 'captain';
const isChooser = variant === 'chooser';
const name = isCaptain ? 'Nandyal Ride Captain' : isChooser ? 'Nandyal Ride Demo' : 'Nandyal Ride';
const slug = isCaptain ? 'nandyal-ride-captain' : isChooser ? 'nandyal-ride-demo' : 'nandyal-ride-customer';
const scheme = isCaptain ? 'exp+nandyal-ride-captain' : isChooser ? 'exp+nandyal-ride-demo' : 'exp+nandyal-ride-customer';
const androidPackage = isCaptain ? 'com.nandyalride.captain' : isChooser ? 'com.nandyalride.demo' : 'com.nandyalride.customer';
const iosBundleIdentifier = isCaptain ? 'com.nandyalride.captain' : isChooser ? 'com.nandyalride.demo' : 'com.nandyalride.customer';
const googleServicesFile = isCaptain ? './firebase/nandyalride-captain.json' : './firebase/nandyalride-customer.json';

const config: ExpoConfig = {
  name, slug, scheme, version: '1.0.0', orientation: 'portrait', userInterfaceStyle: 'light',
  splash: { resizeMode: 'contain', backgroundColor: '#FFFFFF' }, assetBundlePatterns: ['**/*'],
  android: {
    package: androidPackage,
    googleServicesFile,
    config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '' } },
    permissions: isCaptain ? ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA', 'POST_NOTIFICATIONS'] : ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS', 'READ_CONTACTS'],
  },
  ios: {
    bundleIdentifier: iosBundleIdentifier,
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Nandyal Ride uses your location to set your pickup point and show ride progress.',
      ...(isCaptain ? {
        NSCameraUsageDescription: 'Nandyal Ride Captain uses your camera to capture captain documents.',
        NSPhotoLibraryUsageDescription: 'Nandyal Ride Captain lets you select document photos from your library.',
      } : {
        NSContactsUsageDescription: 'Nandyal Ride uses your contacts to let you add emergency contacts.',
      }),
    },
  },
  plugins: [
    'expo-notifications',
    'expo-location',
    ...(isCaptain ? [] : [['expo-contacts', { contactsPermission: 'Allow Nandyal Ride to access your contacts so you can add emergency contacts.' }]]),
    ...(isCaptain ? [['expo-image-picker', { cameraPermission: 'Allow Nandyal Ride Captain to use your camera for documents.', photosPermission: 'Allow Nandyal Ride Captain to access document photos.' }]] : []),
  ],
  extra: {
    appMode: variant,
    // Public EAS project identifiers. Each independently installed app has its
    // own EAS project because it also has a distinct Android package identifier.
    eas: {
      projectId: isCaptain
        ? '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13'
        : '1158ff7e-1da5-4a6a-9080-14791394da7a',
    },
  },
};
export default config;
