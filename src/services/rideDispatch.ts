import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { Coordinate, RideKind } from '../screens/CustomerScreens';

let rideSubscriptionSequence = 0;

export type RideStatus = 'requested' | 'searching' | 'accepted' | 'arrived' | 'in_progress' | 'completed' | 'cancelled';
export type DispatchRide = {
  id: string;
  status: RideStatus;
  customer_id: string;
  captain_id: string | null;
  ride_type: RideKind;
  pickup_address: string;
  drop_address: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  drop_latitude: number | null;
  drop_longitude: number | null;
  estimated_fare: number;
  final_fare?: number | null;
  captain_latitude?: number | null;
  captain_longitude?: number | null;
  payment_status?: 'pending' | 'paid';
  payment_method?: 'cash' | 'upi' | null;
  customer_rating?: number | null;
  cancellation_reason_code?: string | null;
  cancellation_reason_detail?: string | null;
  cancellation_charge?: number | null;
  travelled_distance_km?: number | null;
};

export type AssignedCaptainDetails = {
  fullName: string;
  vehicleType: RideKind | null;
};

export type CaptainRideRequest = {
  offerId: string;
  rideId: string;
  customerName: string;
  maskedCustomerNumber: string;
  pickupArea: string;
  destinationArea: string;
  distanceKm: number;
  etaMinutes: number;
  expiresAt: string;
  fare: number;
  pickup: Coordinate;
  drop: Coordinate;
};

export type CaptainActiveRide = CaptainRideRequest & {
  status: Extract<RideStatus, 'accepted' | 'arrived' | 'in_progress'>;
};

const requireClient = () => {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
};

async function currentUserId() {
  const client = requireClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session?.user) throw new Error('AUTHENTICATION_REQUIRED');
  return session.user.id;
}

const asNumber = (value: unknown) => typeof value === 'number' ? value : Number(value ?? 0);

function toCaptainRequest(offer: any): CaptainRideRequest | null {
  if (!offer) return null;
  return {
    offerId: offer.offer_id, rideId: offer.ride_id, customerName: 'Customer', maskedCustomerNumber: '+919876543210',
    pickupArea: offer.pickup_address, destinationArea: offer.drop_address,
    distanceKm: asNumber(offer.pickup_distance_meters) / 1000,
    etaMinutes: Math.max(1, Math.ceil(asNumber(offer.pickup_eta_seconds) / 60)), expiresAt: offer.expires_at,
    fare: asNumber(offer.estimated_fare),
    pickup: { latitude: asNumber(offer.pickup_latitude), longitude: asNumber(offer.pickup_longitude) },
    drop: { latitude: asNumber(offer.drop_latitude), longitude: asNumber(offer.drop_longitude) },
  };
}

async function getCaptainOpenOffer() {
  const client = requireClient();
  const { data, error } = await client.rpc('captain_open_offer').maybeSingle();
  if (error) throw error;
  return data ? toCaptainRequest(data) : null;
}

export const rideDispatchService = {
  isEnabled: isSupabaseConfigured,

  async requestRide(draft: {
    kind: RideKind;
    pickup: string;
    drop: string;
    pickupCoordinate?: Coordinate;
    dropCoordinate?: Coordinate;
  }) {
    const client = requireClient();
    const { data, error } = await client.rpc('request_ride', {
      p_ride_type: draft.kind,
      p_pickup_address: draft.pickup.trim(),
      p_drop_address: draft.drop.trim(),
      p_pickup_latitude: draft.pickupCoordinate?.latitude ?? null,
      p_pickup_longitude: draft.pickupCoordinate?.longitude ?? null,
      p_drop_latitude: draft.dropCoordinate?.latitude ?? null,
      p_drop_longitude: draft.dropCoordinate?.longitude ?? null,
    });
    if (error || !data) throw error ?? new Error('Ride request was not created');
    return data as string;
  },

  async getRide(rideId: string) {
    const { data, error } = await requireClient().from('rides').select('*').eq('id', rideId).single();
    if (error || !data) throw error ?? new Error('Ride not found');
    return data as DispatchRide;
  },

  async getAssignedCaptain(rideId: string): Promise<AssignedCaptainDetails | null> {
    const { data, error } = await requireClient()
      .rpc('customer_assigned_captain', { p_ride_id: rideId })
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const assignedCaptain = data as { full_name: string; vehicle_type: RideKind | null };
    return { fullName: assignedCaptain.full_name, vehicleType: assignedCaptain.vehicle_type };
  },

  async getCustomerPickupPin(rideId: string) {
    const { data, error } = await requireClient().rpc('customer_pickup_pin', { p_ride_id: rideId });
    if (error) throw error;
    return data as string | null;
  },

  async getCaptainActiveRide(): Promise<CaptainActiveRide | null> {
    const captainId = await currentUserId();
    const { data, error } = await requireClient()
      .from('rides')
      .select('*')
      .eq('captain_id', captainId)
      .in('status', ['accepted', 'arrived', 'in_progress'])
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const ride = data as DispatchRide;
    return {
      offerId: '',
      rideId: ride.id,
      customerName: 'Customer',
      maskedCustomerNumber: '+919876543210',
      pickupArea: ride.pickup_address,
      destinationArea: ride.drop_address,
      distanceKm: 0,
      etaMinutes: 1,
      expiresAt: '',
      fare: asNumber(ride.estimated_fare),
      pickup: { latitude: asNumber(ride.pickup_latitude), longitude: asNumber(ride.pickup_longitude) },
      drop: { latitude: asNumber(ride.drop_latitude), longitude: asNumber(ride.drop_longitude) },
      status: ride.status as CaptainActiveRide['status'],
    };
  },

  subscribeToRide(rideId: string, onRide: (ride: DispatchRide) => void, onError?: (error: Error) => void) {
    if (!supabase) return () => {};
    const client = supabase;
    let channel: RealtimeChannel | null = null;
    const refresh = () => { void this.getRide(rideId).then(onRide).catch((error) => onError?.(error)); };
    refresh();
    // Navigation can briefly mount the next ride screen before React has
    // finished removing the previous one. A distinct local channel topic
    // prevents Supabase from attempting to add callbacks after subscribe().
    channel = client.channel(`ride:${rideId}:${++rideSubscriptionSequence}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, refresh)
      .subscribe();
    return () => { if (channel) void client.removeChannel(channel); };
  },

  async setCaptainAvailability(isOnline: boolean, location?: Coordinate | null) {
    const client = requireClient();
    const captainId = await currentUserId();
    const { error } = await client.from('captain_availability').upsert({
      captain_id: captainId,
      is_online: isOnline,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    if (isOnline) await this.refreshCaptainDispatch();
  },

  async refreshCaptainDispatch() {
    const { error } = await requireClient().rpc('refresh_captain_dispatch');
    if (error) throw error;
  },

  subscribeToCaptainOffers(onRequest: (request: CaptainRideRequest | null) => void, onError?: (error: Error) => void) {
    if (!supabase) return () => {};
    const client = supabase;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    const start = async () => {
      try {
        const captainId = await currentUserId();
        const refresh = () => { void this.refreshCaptainDispatch().then(() => getCaptainOpenOffer()).then(onRequest).catch((error) => onError?.(error)); };
        refresh();
        channel = client.channel(`captain-offers:${captainId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_offers', filter: `captain_id=eq.${captainId}` }, refresh)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, refresh)
          .subscribe();
        retryTimer = setInterval(refresh, 10_000);
      } catch (error) { onError?.(error as Error); }
    };
    void start();
    return () => { if (retryTimer) clearInterval(retryTimer); if (channel) void client.removeChannel(channel); };
  },

  async respondToOffer(offerId: string, accept: boolean) {
    const { data, error } = await requireClient().rpc('respond_to_ride_offer', { p_offer_id: offerId, p_accept: accept });
    if (error || !data) throw error ?? new Error('Ride offer could not be updated');
    return data as DispatchRide;
  },

  async transitionRide(rideId: string, nextStatus: 'arrived' | 'in_progress' | 'completed') {
    const { data, error } = await requireClient().rpc('captain_transition_ride', { p_ride_id: rideId, p_next_status: nextStatus });
    if (error || !data) throw error ?? new Error('Ride status could not be updated');
    return data as DispatchRide;
  },

  async startRide(rideId: string, pickupOtp: string) {
    const { data, error } = await requireClient().rpc('captain_start_ride', { p_ride_id: rideId, p_pickup_otp: pickupOtp });
    if (error || !data) throw error ?? new Error('Pickup OTP could not be verified');
    return data as DispatchRide;
  },

  async updateCaptainLocation(rideId: string, location: Coordinate) {
    const { error } = await requireClient().rpc('captain_update_ride_location', {
      p_ride_id: rideId, p_latitude: location.latitude, p_longitude: location.longitude,
    });
    if (error) throw error;
  },

  async confirmCustomerPayment(rideId: string, method: 'cash' | 'upi') {
    const { data, error } = await requireClient().rpc('customer_confirm_payment', { p_ride_id: rideId, p_method: method });
    if (error || !data) throw error ?? new Error('Payment could not be saved');
    return data as DispatchRide;
  },

  async rateCaptain(rideId: string, rating: number, note?: string) {
    const { error } = await requireClient().rpc('customer_rate_captain', { p_ride_id: rideId, p_rating: rating, p_note: note?.trim() || null });
    if (error) throw error;
  },
};
