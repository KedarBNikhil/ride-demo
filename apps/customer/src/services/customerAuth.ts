import { registerPushNotifications } from './pushNotifications';
import { createProductionAuthService } from './productionAuth';
import { supabase } from '../lib/supabase';
import { toIndianE164 } from './authMode';

const productionAuth = createProductionAuthService('customer');

export const customerAuthService = {
  sendOtp: productionAuth.sendOtp,
  async sendLoginOtp(phone: string) {
    const client = supabase;
    if (!client) throw new Error('SUPABASE_NOT_CONFIGURED');
    const normalizedPhone = toIndianE164(phone);
    const { data, error } = await client.rpc('customer_login_account_exists', { p_phone: normalizedPhone });
    if (error) throw error;
    if (!data) return { requested: false };
    return productionAuth.sendOtp(normalizedPhone);
  },
  async verifyOtp(phone: string, otp: string) {
    await productionAuth.verifyOtp(phone, otp);
    void registerPushNotifications('customer').catch(() => undefined);
    return { verified: true };
  },
  async saveSignupProfile(name: string) {
    const client = supabase;
    if (!client) throw new Error('SUPABASE_NOT_CONFIGURED');
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) throw userError ?? new Error('AUTHENTICATION_REQUIRED');
    const { error } = await client.from('profiles').update({ full_name: name.trim() }).eq('id', user.id);
    if (error) throw error;
  },
};
