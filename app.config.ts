import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Nandyal Ride Demo', slug: 'nandyal-ride-demo', version: '1.0.0', orientation: 'portrait', userInterfaceStyle: 'light',
  splash: { resizeMode: 'contain', backgroundColor: '#FFFFFF' }, assetBundlePatterns: ['**/*'],
  android: {
    config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '' } },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA'],
  },
  ios: {
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Nandyal Ride uses your location to set your pickup point on the map.',
      NSCameraUsageDescription: 'Nandyal Ride uses your camera to capture captain documents.',
      NSPhotoLibraryUsageDescription: 'Nandyal Ride lets captains select document photos from their library.',
    },
  },
  plugins: [['expo-image-picker', { cameraPermission: 'Allow Nandyal Ride to use your camera for captain documents.', photosPermission: 'Allow Nandyal Ride to access document photos.' }]],
  extra: { googlePlacesApiKey: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '' },
};
export default config;
