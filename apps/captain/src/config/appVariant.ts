import Constants from 'expo-constants';
import { applicationId } from 'expo-application';

export type AppVariant = 'captain';
const expectedApplicationId = 'com.nandyalride.captain';
const expectedProjectId = '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13';

// `applicationId`/bundle ID is compiled into the installed native binary and
// cannot be changed by an OTA. Expo config and EXPO_PUBLIC_* values are part
// of the update manifest/bundle and must therefore be treated as untrusted at
// startup. A mismatch deliberately prevents either app flow from rendering.
const manifestVariant = Constants.expoConfig?.extra?.appMode;
const manifestProjectId = Constants.expoConfig?.extra?.eas?.projectId;

if (applicationId !== expectedApplicationId || manifestVariant !== 'captain' || manifestProjectId !== expectedProjectId) {
  throw new Error(
    `Application identity mismatch: native ${String(applicationId)} requires captain/${expectedProjectId}, ` +
    `but the loaded update declares ${String(manifestVariant)}/${String(manifestProjectId)}.`
  );
}

export const appVariant: AppVariant = 'captain';
