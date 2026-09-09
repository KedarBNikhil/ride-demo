import Constants from 'expo-constants';
import { applicationId } from 'expo-application';

export type AppVariant = 'customer';
const expectedApplicationId = 'com.nandyalride.customer';
const expectedProjectId = '1158ff7e-1da5-4a6a-9080-14791394da7a';

// `applicationId`/bundle ID is compiled into the installed native binary and
// cannot be changed by an OTA. Expo config and EXPO_PUBLIC_* values are part
// of the update manifest/bundle and must therefore be treated as untrusted at
// startup. A mismatch deliberately prevents either app flow from rendering.
const manifestVariant = Constants.expoConfig?.extra?.appMode;
const manifestProjectId = Constants.expoConfig?.extra?.eas?.projectId;

if (applicationId !== expectedApplicationId || manifestVariant !== 'customer' || manifestProjectId !== expectedProjectId) {
  throw new Error(
    `Application identity mismatch: native ${String(applicationId)} requires customer/${expectedProjectId}, ` +
    `but the loaded update declares ${String(manifestVariant)}/${String(manifestProjectId)}.`
  );
}

export const appVariant: AppVariant = 'customer';
