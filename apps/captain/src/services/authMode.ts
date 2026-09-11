import { resolveAuthMode, type AuthMode } from './authModePolicy';

// This flag selects the handset login experience only. The database setting is
// the security authority and must be enabled separately for a pilot release.
// Demo is available only to an explicitly configured development JS bundle.
export { resolveAuthMode, type AuthMode } from './authModePolicy';
export const authMode: AuthMode = resolveAuthMode(
  process.env.EXPO_PUBLIC_AUTH_MODE,
  typeof __DEV__ !== 'undefined' && __DEV__,
);

export const isProductionAuthMode = authMode === 'production';

export function toIndianE164(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  throw new Error('INVALID_PHONE');
}
