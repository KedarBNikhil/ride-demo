import type { AppMode } from '../navigation/AppNavigator';

export type AppVariant = AppMode | 'chooser';

const configuredVariant = process.env.EXPO_PUBLIC_APP_MODE;

export const appVariant: AppVariant = configuredVariant === 'captain' || configuredVariant === 'operator' || configuredVariant === 'chooser'
  ? configuredVariant
  : 'customer';

export const isSeparateApp = appVariant !== 'chooser';
