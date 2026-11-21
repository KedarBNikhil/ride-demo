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
  /**
   * `intent://` URLs only work when a browser understands Android's intent
   * syntax. Most share targets render them as plain text. The app already
   * registers this custom scheme in its native manifest, so share it directly.
   */
  shareUrl(token: string) { return `${scheme}://live-ride/${encodeURIComponent(token)}`; },
  storeUrl() { return store; },
};
