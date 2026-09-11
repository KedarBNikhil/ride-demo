import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';
import { getProductionConfigStatus } from '../config/productionConfig';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const productionConfigStatus = getProductionConfigStatus();
export const isSupabaseConfigured = productionConfigStatus.ok;

/**
 * App.tsx blocks normal navigation when this is false. Keeping the nullable
 * type avoids manufacturing a client from incomplete production credentials.
 */
export const supabase = isSupabaseConfigured ? createClient(url!, publishableKey!, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
}) : null;

export function getSupabaseClient() {
  if (!supabase) throw new Error(`PRODUCTION_CONFIGURATION_${productionConfigStatus.ok ? 'INVALID' : productionConfigStatus.reason}`);
  return supabase;
}
