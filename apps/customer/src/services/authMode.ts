export type AuthMode = 'demo' | 'production';

// This flag selects the handset login experience only. The database setting is
// the security authority and must be enabled separately for a pilot release.
export const authMode: AuthMode = process.env.EXPO_PUBLIC_AUTH_MODE === 'production' ? 'production' : 'demo';

export const isProductionAuthMode = authMode === 'production';

export function toIndianE164(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  throw new Error('INVALID_PHONE');
}
