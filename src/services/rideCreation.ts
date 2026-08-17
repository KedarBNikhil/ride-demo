import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { rideDispatchService } from './rideDispatch';

export type RideDraft = {
  pickup: string;
  drop: string;
  kind: 'bike' | 'auto';
  passengerCount: number;
  pickupCoordinate?: { latitude: number; longitude: number };
  dropCoordinate?: { latitude: number; longitude: number };
};

export type CreatedRide = { id: string; persisted: boolean };
export type CancellationReason = 'change_plans' | 'another_ride' | 'wait_time' | 'fare_concern' | 'captain_unreachable' | 'other';

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
    if (draft.kind === 'auto' && (!Number.isInteger(draft.passengerCount) || draft.passengerCount < 1 || draft.passengerCount > 3)) throw new Error('Auto passenger count must be between 1 and 3');
    if (draft.kind === 'bike' && draft.passengerCount !== 1) throw new Error('Bike rides support one passenger');

    // The visual demo still works before the Supabase environment is supplied.
    if (!isSupabaseConfigured) return { id: `local-${Date.now()}`, persisted: false };

    await currentCustomerId();
    const id = await rideDispatchService.requestRide(draft);
    return { id, persisted: true };
  },
  async cancel(rideId: string, reasonCode: CancellationReason, reasonDetail?: string) {
    if (!isSupabaseConfigured || rideId.startsWith('local-')) return { persisted: false };

    const { data, error } = await supabase!
      .rpc('customer_cancel_ride', {
        p_ride_id: rideId,
        p_reason_code: reasonCode,
        p_reason_detail: reasonCode === 'other' ? reasonDetail?.trim() : null,
      });

    if (error || !data || data.status !== 'cancelled' || !data.cancelled_at) {
      throw error ?? new Error('Ride cancellation was not saved');
    }
    return { persisted: true, cancellationCharge: Number(data.cancellation_charge ?? 0) };
  },
};
