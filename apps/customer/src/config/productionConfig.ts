import Constants from 'expo-constants';

export type ProductionConfigStatus =
  | { ok: true }
  | { ok: false; reason: 'APP_MODE_INVALID' | 'SUPABASE_URL_MISSING' | 'SUPABASE_PUBLISHABLE_KEY_MISSING' };

export type ProductionConfigInput = {
  appMode?: unknown;
  supabaseUrl?: string | undefined;
  supabasePublishableKey?: string | undefined;
};

export function getProductionConfigStatus(input: ProductionConfigInput = {
  appMode: Constants.expoConfig?.extra?.appMode,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}): ProductionConfigStatus {
  if (input.appMode !== 'customer') return { ok: false, reason: 'APP_MODE_INVALID' };
  if (!input.supabaseUrl?.trim()) return { ok: false, reason: 'SUPABASE_URL_MISSING' };
  if (!input.supabasePublishableKey?.trim()) return { ok: false, reason: 'SUPABASE_PUBLISHABLE_KEY_MISSING' };
  return { ok: true };
}
