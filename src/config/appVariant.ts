import Constants from 'expo-constants';
import type { AppMode } from '../navigation/AppNavigator';

export type AppVariant = AppMode | 'chooser';

// Expo/Metro's transform cache is not a safe source of truth for a variant
// switch: a cached public environment replacement can otherwise carry the
// previous app's mode into an OTA bundle. The manifest is generated together
// with the native app/update and is the authoritative variant identity.
const manifestVariant = Constants.expoConfig?.extra?.appMode;
const configuredVariant = typeof manifestVariant === 'string' ? manifestVariant : process.env.EXPO_PUBLIC_APP_MODE;

export const appVariant: AppVariant = configuredVariant === 'captain' || configuredVariant === 'operator' || configuredVariant === 'chooser'
  ? configuredVariant
  : 'customer';

export const isSeparateApp = appVariant !== 'chooser';
