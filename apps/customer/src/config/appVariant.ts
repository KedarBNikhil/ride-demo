import Constants from 'expo-constants';
import { applicationId } from 'expo-application';

export type AppVariant = 'customer';

const expectedIdentities = {
  production: {
    applicationId: 'com.nandyalride.customer',
    projectId: '1158ff7e-1da5-4a6a-9080-14791394da7a',
  },
  staging: {
    applicationId: 'com.nandyalride.customer.staging',
    projectId: '27afc445-8b40-4df5-b574-ef52c4e36274',
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
  || manifestVariant !== 'customer'
  || manifestProjectId !== expectedIdentity.projectId
) {
  throw new Error(
    `Application identity mismatch: native ${String(applicationId)} cannot load ` +
    `${String(manifestEnvironment)}/${String(manifestVariant)}/${String(manifestProjectId)}.`,
  );
}

export const appVariant: AppVariant = 'customer';