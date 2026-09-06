import type { RealtimeChannel } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { Coordinate, RideKind } from '../screens/CustomerScreens';

let rideSubscriptionSequence = 0;
const pickupOtpRequests = new Map<string, Promise<string | null>>();
const pickupOtpStorageKey = (rideId: string) => `nandyal-ride-demo.customer.pickupOtp.${rideId}`;

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
  payment_status?: 'pending' | 'declared' | 'confirmed' | 'not_required';
  payment_method?: 'cash' | 'upi' | null;
  customer_charge_amount?: number | null;
  customer_charge_type?: 'free' | 'standard';
  customer_charge_status?: 'pending' | 'declared' | 'not_required';
  pricing_policy_code?: string | null;
  free_ride_sequence?: number | null;
  pricing_distance_meters?: number | null;
  customer_rating?: number | null;
  cancellation_reason_code?: string | null;
  cancellation_reason_detail?: string | null;
  cancellation_charge?: number | null;
  travelled_distance_km?: number | null;
  requested_at?: string | null;
  accepted_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

export type AssignedCaptainDetails = {
  fullName: string;
  vehicleType: RideKind | null;
  phone: string | null;
};

export type RideMessage = { id: string; sender_id: string; body: string; created_at: string };

export type ReceivedRating = {
  average: number | null;
  count: number;
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

export type CaptainRidePayout = {
  captain_earning_amount: number;
  payout_status: 'not_started' | 'initiated' | 'processing' | 'paid' | 'failed' | 'reversed' | 'held';
  is_held: boolean;
};

export type CaptainRideDetails = {
  ride: DispatchRide;
  customerName: string | null;
  payout: CaptainRidePayout | null;
};

export type CustomerPromotionStatus = {
  promotion_enabled: boolean;
  policy_code: string;
  maximum_free_rides: number;
  maximum_free_distance_meters: number;
  completed_free_rides: number;
  reserved_free_rides: number;
  remaining_free_rides: number;
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
  tripDistanceMeters?: number | null;
  travelledDistanceKm?: number | null;
  pickupDurationSeconds?: number | null;
  tripDurationSeconds?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  fareBreakdown?: Pick<DispatchRide, 'estimated_fare' | 'final_fare' | 'base_fare' | 'distance_surcharge' | 'pickup_surcharge'>;
};

export type CaptainActiveRide = CaptainRideRequest & {
  status: Extract<RideStatus, 'accepted' | 'arrived' | 'in_progress'>;
};

const requireClient = () => {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  return supabase;
};

async function edgeFunctionError(error: unknown) {
  const context = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  const payload = await context?.json?.().catch(() => null);
  const message = (payload as { error?: unknown } | null)?.error;
  return new Error(typeof message === 'string' ? message : error instanceof Error ? error.message : 'Ride offer could not be updated');
}

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
    offerId: offer.offer_id ?? '', rideId: offer.ride_id, customerName: offer.customer_name?.trim() || '—', maskedCustomerNumber: offer.customer_phone?.trim() || '',
    pickupArea: offer.pickup_address, destinationArea: offer.drop_address,
    distanceKm: asNumber(offer.pickup_distance_meters) / 1000,
    etaMinutes: Math.max(1, Math.ceil(asNumber(offer.pickup_eta_seconds) / 60)), expiresAt: offer.expires_at,
    fare: asNumber(offer.estimated_fare),
    pickup: { latitude: asNumber(offer.pickup_latitude), longitude: asNumber(offer.pickup_longitude) },
    drop: { latitude: asNumber(offer.drop_latitude), longitude: asNumber(offer.drop_longitude) },
    tripDistanceMeters: offer.trip_distance_meters == null ? null : asNumber(offer.trip_distance_meters),
    travelledDistanceKm: offer.travelled_distance_km == null ? null : asNumber(offer.travelled_distance_km),
    pickupDurationSeconds: offer.pickup_duration_seconds == null ? null : asNumber(offer.pickup_duration_seconds),
    tripDurationSeconds: offer.trip_duration_seconds == null ? null : asNumber(offer.trip_duration_seconds),
    startedAt: offer.started_at ?? null, completedAt: offer.completed_at ?? null,
    fareBreakdown: { estimated_fare: asNumber(offer.estimated_fare), final_fare: offer.final_fare == null ? null : asNumber(offer.final_fare), base_fare: offer.base_fare == null ? null : asNumber(offer.base_fare), distance_surcharge: offer.distance_surcharge == null ? null : asNumber(offer.distance_surcharge), pickup_surcharge: offer.pickup_surcharge == null ? null : asNumber(offer.pickup_surcharge) },
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

  async getCustomerActiveRide(): Promise<DispatchRide | null> {
    const rides = await this.getCustomerRideHistory();
    return rides.find((ride) => ['requested', 'searching', 'accepted', 'arrived', 'in_progress'].includes(ride.status)) ?? null;
  },

  async getCustomerPromotionStatus(): Promise<CustomerPromotionStatus | null> {
    const { data, error } = await requireClient().rpc('customer_promotion_status').maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const status = data as Record<string, unknown>;
    return {
      promotion_enabled: Boolean(status.promotion_enabled), policy_code: String(status.policy_code ?? ''),
      maximum_free_rides: asNumber(status.maximum_free_rides), maximum_free_distance_meters: asNumber(status.maximum_free_distance_meters),
      completed_free_rides: asNumber(status.completed_free_rides), reserved_free_rides: asNumber(status.reserved_free_rides), remaining_free_rides: asNumber(status.remaining_free_rides),
    };
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

  subscribeToCaptainRides(onChange: () => void, onError?: (error: Error) => void) {
    if (!supabase) return () => {};
    const client = supabase;
    let channel: RealtimeChannel | null = null;
    const start = async () => {
      try {
        const captainId = await currentUserId();
        channel = client.channel(`captain-rides:${captainId}:${++rideSubscriptionSequence}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `captain_id=eq.${captainId}` }, onChange)
          .subscribe();
      } catch (error) { onError?.(error as Error); }
    };
    void start();
    return () => { if (channel) void client.removeChannel(channel); };
  },

  async getAssignedCaptain(rideId: string): Promise<AssignedCaptainDetails | null> {
    const { data, error } = await requireClient()
      .rpc('customer_assigned_captain_contact', { p_ride_id: rideId })
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const assignedCaptain = data as { full_name: string; vehicle_type: RideKind | null; phone: string | null };
    return { fullName: assignedCaptain.full_name, vehicleType: assignedCaptain.vehicle_type, phone: assignedCaptain.phone };
  },

  async getRideMessages(rideId: string): Promise<RideMessage[]> {
    const { data, error } = await requireClient().rpc('ride_messages_for_ride', { p_ride_id: rideId });
    if (error) throw error;
    return (data ?? []) as RideMessage[];
  },

  async sendRideMessage(rideId: string, body: string) {
    const { error } = await requireClient().rpc('send_ride_message', { p_ride_id: rideId, p_body: body.trim() });
    if (error) throw error;
  },

  subscribeToRideMessages(rideId: string, onMessages: (messages: RideMessage[]) => void, onError?: (error: Error) => void) {
    if (!supabase) return () => {};
    const client = supabase;
    const refresh = () => { void this.getRideMessages(rideId).then(onMessages).catch((error) => onError?.(error)); };
    refresh();
    const channel = client.channel(`ride-messages:${rideId}:${++rideSubscriptionSequence}`).on('postgres_changes', { event: '*', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` }, refresh).subscribe();
    return () => { void client.removeChannel(channel); };
  },

  async issueCustomerPickupOtp(rideId: string) {
    const inFlight = pickupOtpRequests.get(rideId);
    if (inFlight) return inFlight;
    const request = AsyncStorage.getItem(pickupOtpStorageKey(rideId)).then((storedOtp) => {
      if (storedOtp) return storedOtp;
      return requireClient().rpc('issue_customer_pickup_otp', { p_ride_id: rideId }).then(({ data, error }) => {
        if (error) throw error;
        return data as string | null;
      })
    })
      .then(async (pickupOtp) => {
        if (pickupOtp) await AsyncStorage.setItem(pickupOtpStorageKey(rideId), pickupOtp);
        return pickupOtp;
      })
      .finally(() => {
        if (pickupOtpRequests.get(rideId) === request) pickupOtpRequests.delete(rideId);
      });
    pickupOtpRequests.set(rideId, request);
    return request;
  },

  async getStoredCustomerPickupOtp(rideId: string) {
    return AsyncStorage.getItem(pickupOtpStorageKey(rideId));
  },

  async clearStoredCustomerPickupOtp(rideId: string) {
    await AsyncStorage.removeItem(pickupOtpStorageKey(rideId));
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
    const { data: detail, error: detailError } = await requireClient().rpc('captain_ride_detail', { p_ride_id: ride.id }).maybeSingle();
    if (detailError || !detail) throw detailError ?? new Error('Captain ride detail is unavailable');
    const request = toCaptainRequest(detail);
    if (!request) return null;
    return { ...request, status: ride.status as CaptainActiveRide['status'] };
  },

  async getCaptainLatestRide(): Promise<DispatchRide | null> {
    const captainId = await currentUserId();
    const { data, error } = await requireClient().from('rides').select('*').eq('captain_id', captainId).order('requested_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return data as DispatchRide | null;
  },

  async getCaptainRideHistory(before?: string, limit = 20): Promise<DispatchRide[]> {
    const { data, error } = await requireClient().rpc('captain_ride_history', { p_before: before ?? null, p_limit: limit });
    if (error) throw error;
    return (data ?? []) as DispatchRide[];
  },

  async getCaptainRideDetails(rideId: string): Promise<CaptainRideDetails> {
    const [ride, detail, payout] = await Promise.all([
      this.getRide(rideId),
      requireClient().rpc('captain_ride_detail', { p_ride_id: rideId }).maybeSingle(),
      this.getCaptainRidePayout(rideId).catch(() => null),
    ]);
    if (detail.error || !detail.data) throw detail.error ?? new Error('Captain ride detail is unavailable');
    return { ride, customerName: typeof (detail.data as { customer_name?: unknown }).customer_name === 'string' ? (detail.data as { customer_name: string }).customer_name : null, payout };
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
    return getCaptainOpenOffer();
  },

  subscribeToRide(rideId: string, onRide: (ride: DispatchRide) => void, onError?: (error: Error) => void) {
    if (!supabase) return () => {};
    const client = supabase;
    let channel: RealtimeChannel | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    const refresh = () => { void this.getRide(rideId).then(onRide).catch((error) => onError?.(error)); };
    refresh();
    // Navigation can briefly mount the next ride screen before React has
    // finished removing the previous one. A distinct local channel topic
    // prevents Supabase from attempting to add callbacks after subscribe().
    channel = client.channel(`ride:${rideId}:${++rideSubscriptionSequence}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` }, refresh)
      .subscribe();
    // Keep an authoritative status refresh as a fallback if a device briefly
    // misses a Realtime event.
    refreshTimer = setInterval(refresh, 10_000);
    return () => { if (refreshTimer) clearInterval(refreshTimer); if (channel) void client.removeChannel(channel); };
  },

  async setCaptainAvailability(isOnline: boolean, location?: Coordinate | null) {
    const { error } = await requireClient().rpc('captain_set_availability', {
      p_is_online: isOnline,
      p_latitude: location?.latitude ?? null,
      p_longitude: location?.longitude ?? null,
    });
    if (error) throw error;
  },

  async getCaptainAvailability() {
    const captainId = await currentUserId();
    const { data, error } = await requireClient().from('captain_availability').select('is_online').eq('captain_id', captainId).maybeSingle();
    if (error) throw error;
    return Boolean(data?.is_online);
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
      if (error) throw await edgeFunctionError(error);
      if (!ride) throw new Error((data as { error?: string } | null)?.error ?? 'Ride offer could not be updated');
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
    await this.clearStoredCustomerPickupOtp(rideId);
    return data as DispatchRide;
  },

  async updateCaptainLocation(rideId: string, location: Coordinate) {
    const { error } = await requireClient().rpc('captain_update_ride_location', {
      p_ride_id: rideId,
      p_latitude: location.latitude,
      p_longitude: location.longitude,
    });
    if (error) throw error;
  },

  async confirmCustomerPayment(rideId: string, method: 'cash' | 'upi') {
    const { data, error } = await requireClient().rpc('customer_confirm_payment', { p_ride_id: rideId, p_method: method });
    if (error || !data) throw error ?? new Error('Payment could not be saved');
    return data as DispatchRide;
  },

  async confirmCaptainPaymentReceived(rideId: string) {
    const { data, error } = await requireClient().rpc('captain_confirm_payment_received', { p_ride_id: rideId });
    if (error || !data) throw error ?? new Error('Payment could not be confirmed');
    return data as DispatchRide;
  },

  async getSettlementQueue(status: SettlementQueueItem['settlement_status'] | null = 'awaiting_review') {
    const { data, error } = await requireClient().rpc('operator_settlement_queue', { p_status: status });
    if (error) throw error;
    return (data ?? []).map((item: SettlementQueueItem) => ({ ...item, amount_due: asNumber(item.amount_due) })) as SettlementQueueItem[];
  },

  async getCaptainRidePayout(rideId: string): Promise<CaptainRidePayout | null> {
    const { data, error } = await requireClient().rpc('captain_ride_payout', { p_ride_id: rideId }).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const payout = data as Omit<CaptainRidePayout, 'captain_earning_amount' | 'is_held'> & { captain_earning_amount: unknown; is_held: unknown };
    return { ...payout, captain_earning_amount: asNumber(payout.captain_earning_amount), is_held: Boolean(payout.is_held) } as CaptainRidePayout;
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
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('INVALID_RATING');
    const { error } = await requireClient().rpc('customer_rate_captain', { p_ride_id: rideId, p_rating: rating, p_note: note?.trim() || null });
    if (error) throw error;
  },

  async raiseCaptainPaymentIssue(rideId: string, reason: string) {
    const { error } = await requireClient().rpc('captain_raise_payment_issue', { p_ride_id: rideId, p_reason: reason });
    if (error) throw error;
  },

  async raiseCustomerPaymentIssue(rideId: string, reason: string) {
    const { error } = await requireClient().rpc('customer_raise_payment_issue', { p_ride_id: rideId, p_reason: reason });
    if (error) throw error;
  },

  async rateCustomer(rideId: string, rating: number, note?: string) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('INVALID_RATING');
    const { error } = await requireClient().rpc('captain_rate_customer', { p_ride_id: rideId, p_rating: rating, p_note: note?.trim() || null });
    if (error) throw error;
  },

  async getReceivedRating(role: 'customer' | 'captain'): Promise<ReceivedRating> {
    const userId = await currentUserId();
    const recipientColumn = role === 'captain' ? 'captain_id' : 'customer_id';
    const ratingColumn = role === 'captain' ? 'customer_rating' : 'captain_rating';
    const { data, error } = await requireClient()
      .from('rides')
      .select('customer_rating, captain_rating')
      .eq(recipientColumn, userId)
      .not(ratingColumn, 'is', null);
    if (error) throw error;
    const ratings = (data ?? [])
      .map((ride) => Number(role === 'captain' ? ride.customer_rating : ride.captain_rating))
      .filter((rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5);
    return { count: ratings.length, average: ratings.length ? ratings.reduce((total, rating) => total + rating, 0) / ratings.length : null };
  },
};
