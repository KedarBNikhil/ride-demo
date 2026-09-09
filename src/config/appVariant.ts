import Constants from 'expo-constants';
import { applicationId } from 'expo-application';
import type { AppMode } from '../navigation/AppNavigator';

export type AppVariant = AppMode | 'chooser';

type SeparateAppIdentity = {
  mode: Extract<AppVariant, 'customer' | 'captain'>;
  projectId: string;
};

const nativeIdentities: Record<string, SeparateAppIdentity> = {
  'com.nandyalride.customer': {
    mode: 'customer',
    projectId: '1158ff7e-1da5-4a6a-9080-14791394da7a',
  },
  'com.nandyalride.captain': {
    mode: 'captain',
    projectId: '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13',
  },
};

// `applicationId`/bundle ID is compiled into the installed native binary and
// cannot be changed by an OTA. Expo config and EXPO_PUBLIC_* values are part
// of the update manifest/bundle and must therefore be treated as untrusted at
// startup. A mismatch deliberately prevents either app flow from rendering.
const nativeIdentity = applicationId ? nativeIdentities[applicationId] : undefined;
const manifestVariant = Constants.expoConfig?.extra?.appMode;
const manifestProjectId = Constants.expoConfig?.extra?.eas?.projectId;

if (!nativeIdentity) {
  throw new Error(`Unsupported native application identity: ${applicationId ?? 'unavailable'}.`);
}
if (manifestVariant !== nativeIdentity.mode || manifestProjectId !== nativeIdentity.projectId) {
  throw new Error(
    `Application identity mismatch: native ${applicationId} requires ${nativeIdentity.mode}/${nativeIdentity.projectId}, ` +
    `but the loaded update declares ${String(manifestVariant)}/${String(manifestProjectId)}.`
  );
}

export const appVariant: AppVariant = nativeIdentity.mode;

export const isSeparateApp = true;
