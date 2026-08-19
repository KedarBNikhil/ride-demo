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
  passenger_count?: number;
  pricing_rule_version?: string;
  trip_distance_meters?: number | null;
  pickup_distance_meters?: number | null;
  base_fare?: number | null;
  distance_surcharge?: number | null;
  pickup_surcharge?: number | null;
  fare_approval_status?: 'estimated' | 'pending' | 'approved' | 'declined';
  captain_latitude?: number | null;
  captain_longitude?: number | null;
  payment_status?: 'pending' | 'declared';
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

export type SettlementQueueItem = {
  settlement_id: string;
  ride_id: string;
  declared_method: 'cash' | 'upi';
  amount_due: number;
  settlement_status: 'awaiting_review' | 'confirmed' | 'flagged';
  declared_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  pickup_address: string;
  drop_address: string;
  customer_name: string;
  captain_name: string;
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

type CaptainOfferRow = {
  id: string;
  ride_id: string;
  expires_at: string;
  pickup_distance_meters: number | null;
  estimated_pickup_eta_seconds: number | null;
  rides: {
    pickup_address: string;
    drop_address: string;
    pickup_latitude: number | null;
    pickup_longitude: number | null;
    drop_latitude: number | null;
    drop_longitude: number | null;
    estimated_fare: number;
  } | null;
};

export const rideDispatchService = {
  isEnabled: isSupabaseConfigured,

  async requestRide(draft: {
    kind: RideKind;
    pickup: string;
    drop: string;
    passengerCount: number;
    pickupCoordinate?: Coordinate;
    dropCoordinate?: Coordinate;
    routeQuote?: { id: string; distanceMeters: number; durationSeconds: number; encodedPolyline: string };
  }) {
    const client = requireClient();
    const { data, error } = await client.functions.invoke('ride-maps', { body: { action: 'create_routed_ride', draft } });
    const rideId = (data as { data?: { rideId?: string }; error?: string } | null)?.data?.rideId;
    if (error || !rideId) throw error ?? new Error((data as { error?: string } | null)?.error ?? 'Ride request was not created');
    return rideId;
  },

  async getRide(rideId: string) {
    const { data, error } = await requireClient().from('rides').select('*').eq('id', rideId).single();
    if (error || !data) throw error ?? new Error('Ride not found');
    return data as DispatchRide;
  },

  async getCustomerRideHistory(): Promise<DispatchRide[]> {
    const customerId = await currentUserId();
    const { data, error } = await requireClient()
      .from('rides')
      .select('*')
      .eq('customer_id', customerId)
      .order('requested_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DispatchRide[];
  },

  subscribeToCustomerRideHistory(onRides: (rides: DispatchRide[]) => void, onError?: (error: Error) => void) {
    if (!supabase) return () => {};
    const client = supabase;
    let channel: RealtimeChannel | null = null;
    const start = async () => {
      try {
        const customerId = await currentUserId();
        const refresh = () => { void this.getCustomerRideHistory().then(onRides).catch((error) => onError?.(error)); };
        refresh();
        channel = client.channel(`customer-rides:${customerId}:${++rideSubscriptionSequence}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `customer_id=eq.${customerId}` }, refresh)
          .subscribe();
      } catch (error) { onError?.(error as Error); }
    };
    void start();
    return () => { if (channel) void client.removeChannel(channel); };
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

  async issueCustomerPickupOtp(rideId: string) {
    const { data, error } = await requireClient().rpc('issue_customer_pickup_otp', { p_ride_id: rideId });
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

  async getCaptainLatestRide(): Promise<DispatchRide | null> {
    const captainId = await currentUserId();
    const { data, error } = await requireClient().from('rides').select('*').eq('captain_id', captainId).order('requested_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as DispatchRide | null;
  },

  async getCaptainPendingOffer(rideId: string, offerId: string): Promise<CaptainRideRequest | null> {
    const { data, error } = await requireClient()
      .from('ride_offers')
      .select('id, ride_id, expires_at, pickup_distance_meters, estimated_pickup_eta_seconds, rides!inner(pickup_address, drop_address, pickup_latitude, pickup_longitude, drop_latitude, drop_longitude, estimated_fare)')
      .eq('id', offerId)
      .eq('ride_id', rideId)
      .eq('status', 'offered')
      .eq('rides.status', 'searching')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    const offer = data as CaptainOfferRow | null;
    if (!offer?.rides) return null;
    return toCaptainRequest({
      offer_id: offer.id,
      ride_id: offer.ride_id,
      expires_at: offer.expires_at,
      pickup_distance_meters: offer.pickup_distance_meters,
      pickup_eta_seconds: offer.estimated_pickup_eta_seconds,
      ...offer.rides,
    });
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
  },

  subscribeToCaptainOffers(onRequest: (request: CaptainRideRequest | null) => void, onError?: (error: Error) => void) {
    if (!supabase) return () => {};
    const client = supabase;
    let channel: RealtimeChannel | null = null;
    let retryTimer: ReturnType<typeof setInterval> | null = null;
    const start = async () => {
      try {
        const captainId = await currentUserId();
        const refresh = () => { void getCaptainOpenOffer().then(onRequest).catch((error) => onError?.(error)); };
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
    if (accept) {
      const { data, error } = await requireClient().functions.invoke('ride-maps', { body: { action: 'accept_offer', offerId } });
      const ride = (data as { data?: { ride?: DispatchRide }; error?: string } | null)?.data?.ride;
      if (error || !ride) throw error ?? new Error((data as { error?: string } | null)?.error ?? 'Ride offer could not be updated');
      return ride;
    }
    const { data, error } = await requireClient().rpc('respond_to_ride_offer', { p_offer_id: offerId, p_accept: accept });
    if (error || !data) throw error ?? new Error('Ride offer could not be updated');
    return data as DispatchRide;
  },

  async approveFareQuote(rideId: string, accept: boolean) {
    const { data, error } = await requireClient().rpc('customer_approve_fare_quote', { p_ride_id: rideId, p_accept: accept });
    if (error || !data) throw error ?? new Error('Fare quote could not be updated');
    return data as DispatchRide;
  },

  async transitionRide(rideId: string, nextStatus: 'arrived' | 'completed') {
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

  async getSettlementQueue(status: SettlementQueueItem['settlement_status'] | null = 'awaiting_review') {
    const { data, error } = await requireClient().rpc('operator_settlement_queue', { p_status: status });
    if (error) throw error;
    return (data ?? []).map((item: SettlementQueueItem) => ({ ...item, amount_due: asNumber(item.amount_due) })) as SettlementQueueItem[];
  },

  async reviewSettlement(settlementId: string, action: 'confirmed' | 'flagged', note?: string) {
    const { error } = await requireClient().rpc('operator_review_settlement', {
      p_settlement_id: settlementId,
      p_action: action,
      p_note: note?.trim() || null,
    });
    if (error) throw error;
  },

  async rateCaptain(rideId: string, rating: number, note?: string) {
    const { error } = await requireClient().rpc('customer_rate_captain', { p_ride_id: rideId, p_rating: rating, p_note: note?.trim() || null });
    if (error) throw error;
  },
};
