import { supabase } from '../lib/supabase';

const scheme = 'exp+nandyal-ride-customer';
const store = 'https://play.google.com/store/apps/details?id=com.nandyalride.customer';
function client() { if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED'); return supabase; }

export const rideLiveShareService = {
  async createToken(rideId: string) {
    const { data, error } = await client().rpc('create_live_ride_share_token', { p_ride_id: rideId }).single();
    if (error || !data || typeof (data as { token?: unknown }).token !== 'string') throw error ?? new Error('LIVE_RIDE_SHARE_UNAVAILABLE');
    return data as { token: string; expires_at: string };
  },
  shareUrl(token: string) { return `intent://live-ride/${encodeURIComponent(token)}#Intent;scheme=${scheme};package=com.nandyalride.customer;S.browser_fallback_url=${encodeURIComponent(store)};end`; },
};
