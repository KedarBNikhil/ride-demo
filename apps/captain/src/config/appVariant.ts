import Constants from 'expo-constants';
import { applicationId } from 'expo-application';

export type AppVariant = 'captain';

const expectedIdentities = {
  production: {
    applicationId: 'com.nandyalride.captain',
    projectId: '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13',
  },
  staging: {
    applicationId: 'com.nandyalride.captain.staging',
    projectId: 'e887f7be-4897-4433-be38-48401a3b223f',
  },
} as const;

const manifestVariant = Constants.expoConfig?.extra?.appMode;
const manifestEnvironment = Constants.expoConfig?.extra?.appEnvironment;
const manifestProjectId = Constants.expoConfig?.extra?.eas?.projectId;

const expectedIdentity = manifestEnvironment === 'production'
  ? expectedIdentities.production
  : manifestEnvironment === 'staging'
    ? expectedIdentities.staging
    : null;

if (
  !expectedIdentity
  || applicationId !== expectedIdentity.applicationId
  || manifestVariant !== 'captain'
  || manifestProjectId !== expectedIdentity.projectId
) {
  throw new Error(
    `Application identity mismatch: native ${String(applicationId)} cannot load ` +
    `${String(manifestEnvironment)}/${String(manifestVariant)}/${String(manifestProjectId)}.`,
  );
}

export const appVariant: AppVariant = 'captain';