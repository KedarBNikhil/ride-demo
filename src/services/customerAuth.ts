import { supabase } from '../lib/supabase';
import { demoAuthService } from './demoAuth';
import { registerPushNotifications } from './pushNotifications';

async function ensureCustomerSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('Unable to create customer account');
  return data.user;
}

/** Demo phone verification plus a persistent Supabase customer profile. */
export const customerAuthService = {
  sendOtp: demoAuthService.sendOtp,
  async verifyOtp(phone: string, otp: string) {
    await demoAuthService.verifyOtp(phone, otp);
    await ensureCustomerSession();
    void registerPushNotifications('customer').catch(() => undefined);
    return { verified: true };
  },
};
