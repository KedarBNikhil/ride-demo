import { isSupabaseConfigured, supabase } from '../lib/supabase';

export type RideDraft = {
  pickup: string;
  drop: string;
  kind: 'bike' | 'auto';
  pickupCoordinate?: { latitude: number; longitude: number };
  dropCoordinate?: { latitude: number; longitude: number };
};

export type CreatedRide = { id: string; persisted: boolean };

const fareFor = (kind: RideDraft['kind']) => kind === 'bike' ? 55 : 75;

async function currentCustomerId() {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) return session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('Unable to create a customer session');
  return data.user.id;
}

/**
 * The only customer-side persistence boundary for a new booking. Keeping this
 * outside the screens makes a future authenticated OTP implementation a
 * session concern rather than a booking-flow rewrite.
 */
export const rideCreationService = {
  async create(draft: RideDraft): Promise<CreatedRide> {
    if (!draft.pickup.trim() || !draft.drop.trim()) throw new Error('Pickup and destination are required');

    // The visual demo still works before the Supabase environment is supplied.
    if (!isSupabaseConfigured) return { id: `local-${Date.now()}`, persisted: false };

    const customerId = await currentCustomerId();
    const { data, error } = await supabase!
      .from('rides')
      .insert({
        customer_id: customerId,
        ride_type: draft.kind,
        pickup_address: draft.pickup.trim(),
        drop_address: draft.drop.trim(),
        pickup_latitude: draft.pickupCoordinate?.latitude ?? null,
        pickup_longitude: draft.pickupCoordinate?.longitude ?? null,
        drop_latitude: draft.dropCoordinate?.latitude ?? null,
        drop_longitude: draft.dropCoordinate?.longitude ?? null,
        estimated_fare: fareFor(draft.kind),
      })
      .select('id')
      .single();

    if (error || !data) throw error ?? new Error('Ride creation did not return an id');
    return { id: data.id, persisted: true };
  },
};
