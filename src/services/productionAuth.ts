import { supabase } from '../lib/supabase';
import { toIndianE164 } from './authMode';

function requireClient() {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
}

export function createProductionAuthService(appVariant: 'customer' | 'captain') {
  return {
    async sendOtp(phone: string) {
      const client = requireClient();
      await client.auth.signOut({ scope: 'local' });
      const { error } = await client.auth.signInWithOtp({ phone: toIndianE164(phone) });
      if (error) throw error;
      return { requested: true };
    },
    async verifyOtp(phone: string, otp: string) {
      const client = requireClient();
      const { data, error } = await client.auth.verifyOtp({ phone: toIndianE164(phone), token: otp, type: 'sms' });
      if (error || !data.session) throw error ?? new Error('PHONE_OTP_VERIFICATION_FAILED');
      const { error: boundaryError } = await client.rpc('verify_pilot_identity', { p_app_variant: appVariant });
      if (boundaryError) {
        await client.auth.signOut({ scope: 'local' });
        throw boundaryError;
      }
      return { verified: true };
    },
  };
}
