import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Nandyal Ride Demo', slug: 'nandyal-ride-demo', version: '1.0.0', orientation: 'portrait', userInterfaceStyle: 'light',
  splash: { resizeMode: 'contain', backgroundColor: '#FFFFFF' }, assetBundlePatterns: ['**/*'],
  android: {
    config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '' } },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
  },
  ios: {
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Nandyal Ride uses your location to set your pickup point on the map.',
    },
  },
  extra: { googlePlacesApiKey: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '' },
};
export default config;
