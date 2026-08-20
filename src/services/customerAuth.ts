import { supabase } from '../lib/supabase';
import { demoAuthService } from './demoAuth';
import { registerPushNotifications } from './pushNotifications';
import { isProductionAuthMode } from './authMode';
import { createProductionAuthService } from './productionAuth';

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
  sendOtp: isProductionAuthMode ? createProductionAuthService('customer').sendOtp : demoAuthService.sendOtp,
  async verifyOtp(phone: string, otp: string) {
    if (isProductionAuthMode) {
      await createProductionAuthService('customer').verifyOtp(phone, otp);
      void registerPushNotifications('customer').catch(() => undefined);
      return { verified: true };
    }
    await demoAuthService.verifyOtp(phone, otp);
    await ensureCustomerSession();
    void registerPushNotifications('customer').catch(() => undefined);
    return { verified: true };
  },
};
