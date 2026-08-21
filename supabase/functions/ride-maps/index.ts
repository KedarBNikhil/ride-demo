import { createClient } from 'npm:@supabase/supabase-js@2';
import { finishGoogleRoutesCall, GoogleRoutesDailyCapError, reserveGoogleRoutesCall } from '../_shared/googleRoutesDailyCap.ts';

type Coordinate = { latitude: number; longitude: number };
type Route = { distanceMeters: number; durationSeconds: number; encodedPolyline: string };

const url = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const googleKey = Deno.env.get('GOOGLE_ROUTING_API_KEY');
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const jsonHeaders = { 'Content-Type': 'application/json' };

function response(data: unknown, status = 200) {
  return Response.json({ data }, { status, headers: jsonHeaders });
}

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: jsonHeaders });
}

function publicKey() {
  const direct = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (direct) return direct;
  const values = Object.values(JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}'));
  return typeof values[0] === 'string' ? values[0] : undefined;
}

function coordinate(value: unknown): Coordinate | null {
  if (!value || typeof value !== 'object') return null;
  const point = value as Record<string, unknown>;
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

function durationSeconds(value: unknown) {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return match ? Math.max(1, Math.round(Number(match[1]))) : 0;
}

async function reservePlacesCall(callKind: string) {
  const { data, error } = await admin.rpc('reserve_google_places_call', { p_call_kind: callKind });
  if (error?.message.includes('GOOGLE_PLACES_DAILY_CAP_REACHED')) throw new Error('Daily Google Places request limit reached. Try again tomorrow.');
  if (error || typeof data !== 'string') throw error ?? new Error('Unable to reserve Google Places call');
  return data;
}

async function finishPlacesCall(callId: string, succeeded: boolean, httpStatus?: number, errorCode?: string) {
  await admin.rpc('finish_google_places_call', { p_call_id: callId, p_succeeded: succeeded, p_http_status: httpStatus ?? null, p_error_code: errorCode ?? null });
}

async function googleJson(endpoint: string, init: RequestInit) {
  if (!googleKey) throw new Error('Google routing is not configured');
  const request = await fetch(endpoint, { ...init, headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey, ...(init.headers ?? {}) } });
  const body = await request.json().catch(() => ({}));
  if (!request.ok) throw Object.assign(new Error((body as { error?: { message?: string } }).error?.message ?? 'Google Maps request failed'), { httpStatus: request.status });
  return body as Record<string, unknown>;
}

async function computeRoute(origin: Coordinate, destination: Coordinate, routeKind: 'initial_trip' | 'captain_to_pickup'): Promise<{ route: Route; callId: string }> {
  const callId = await reserveGoogleRoutesCall(null, routeKind);
  try {
    const body = await googleJson('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', headers: { 'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' },
      body: JSON.stringify({ origin: { location: { latLng: origin } }, destination: { location: { latLng: destination } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', computeAlternativeRoutes: false, languageCode: 'en-IN', units: 'METRIC' }),
    });
    const item = (body.routes as Array<Record<string, unknown>> | undefined)?.[0];
    const route = { distanceMeters: Number(item?.distanceMeters), durationSeconds: durationSeconds(item?.duration), encodedPolyline: String((item?.polyline as Record<string, unknown> | undefined)?.encodedPolyline ?? '') };
    if (!Number.isInteger(route.distanceMeters) || route.distanceMeters < 1 || route.durationSeconds < 1 || !route.encodedPolyline) throw new Error('Google returned an incomplete route');
    await finishGoogleRoutesCall(callId, true, 200);
    return { route, callId };
  } catch (error) {
    await finishGoogleRoutesCall(callId, false, Number((error as { httpStatus?: number }).httpStatus) || undefined, (error as Error).message).catch(() => undefined);
    throw error;
  }
}

async function placeCall<T>(kind: string, work: () => Promise<T>) {
  const callId = await reservePlacesCall(kind);
  try {
    const value = await work();
    await finishPlacesCall(callId, true, 200);
    return value;
  } catch (error) {
    await finishPlacesCall(callId, false, Number((error as { httpStatus?: number }).httpStatus) || undefined, (error as Error).message).catch(() => undefined);
    throw error;
  }
}

async function requirePilotIdentity(userId: string, appVariant: 'customer' | 'captain') {
  const { error } = await admin.rpc('assert_pilot_identity_for_user', { p_user_id: userId, p_app_variant: appVariant });
  if (error) throw new Error(error.message);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return fail('Method not allowed', 405);
  const authorization = request.headers.get('Authorization');
  const token = authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return fail('Authentication required', 401);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return fail('Authentication required', 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = body?.action;
  if (typeof action !== 'string') return fail('Action is required');

  try {
    await requirePilotIdentity(userData.user.id, action === 'accept_offer' ? 'captain' : 'customer');
    if (action === 'autocomplete') {
      const input = String(body?.input ?? '').trim();
      if (input.length < 3 || input.length > 160) return response([]);
      const payload = await placeCall('autocomplete', async () => await googleJson('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST', headers: { 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text' },
        body: JSON.stringify({ input, sessionToken: String(body?.sessionToken ?? '').slice(0, 128), includedRegionCodes: ['in'], locationBias: { circle: { center: { latitude: 15.4889, longitude: 78.4836 }, radius: 25000 } } }),
      }));
      const suggestions = (payload.suggestions as Array<Record<string, unknown>> | undefined) ?? [];
      return response(suggestions.slice(0, 5).flatMap((item) => {
        const prediction = item.placePrediction as Record<string, unknown> | undefined;
        const placeId = prediction?.placeId;
        const text = (prediction?.text as Record<string, unknown> | undefined)?.text;
        return typeof placeId === 'string' && typeof text === 'string' ? [{ placeId, text }] : [];
      }));
    }

    if (action === 'place_details') {
      const placeId = String(body?.placeId ?? '');
      if (!/^[-_A-Za-z0-9]+$/.test(placeId)) return fail('Invalid place');
      const payload = await placeCall('place_details', async () => await googleJson(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(String(body?.sessionToken ?? '').slice(0, 128))}`, { method: 'GET', headers: { 'X-Goog-FieldMask': 'formattedAddress,location' } }));
      const point = coordinate(payload.location);
      const address = typeof payload.formattedAddress === 'string' ? payload.formattedAddress : '';
      if (!point || !address) throw new Error('Google returned an incomplete place');
      return response({ address, coordinate: point });
    }

    if (action === 'geocode' || action === 'reverse_geocode') {
      const isReverse = action === 'reverse_geocode';
      const point = coordinate(body?.coordinate);
      const address = String(body?.address ?? '').trim();
      if ((isReverse && !point) || (!isReverse && (address.length < 3 || address.length > 280))) return fail('Invalid location');
      const params = new URLSearchParams(isReverse ? { latlng: `${point!.latitude},${point!.longitude}`, key: googleKey ?? '' } : { address, components: 'country:IN', region: 'in', key: googleKey ?? '' });
      const payload = await placeCall(isReverse ? 'reverse_geocode' : 'geocode', async () => await googleJson(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { method: 'GET' }));
      const results = (payload.results as Array<Record<string, unknown>> | undefined) ?? [];
      // Never fall back to a landmark for a reverse lookup. A nearby hospital
      // is not a valid substitute for the customer's current street address.
      const result = isReverse ? results.find((candidate) => {
        const types = Array.isArray(candidate.types) ? candidate.types.filter((type): type is string => typeof type === 'string') : [];
        return types.some((type) => ['street_address', 'route', 'neighborhood', 'sublocality', 'sublocality_level_1'].includes(type));
      }) : results[0];
      const resolvedAddress = typeof result?.formatted_address === 'string' ? result.formatted_address : '';
      const resolvedPoint = coordinate((result?.geometry as Record<string, unknown> | undefined)?.location);
      if (!resolvedAddress || (!isReverse && !resolvedPoint)) throw new Error('No address was found');
      return response(isReverse ? { address: resolvedAddress } : { address: resolvedAddress, coordinate: resolvedPoint });
    }

    if (action === 'create_routed_ride') {
      const draft = body?.draft as Record<string, unknown> | undefined;
      const pickup = coordinate(draft?.pickupCoordinate);
      const drop = coordinate(draft?.dropCoordinate);
      const kind = String(draft?.kind ?? '');
      const passengerCount = Number(draft?.passengerCount);
      const pickupAddress = String(draft?.pickup ?? '').trim();
      const dropAddress = String(draft?.drop ?? '').trim();
      const quoteId = String((draft?.routeQuote as Record<string, unknown> | undefined)?.id ?? '');
      if (!pickup || !drop || !['bike', 'auto'].includes(kind) || !Number.isInteger(passengerCount) || !/^[0-9a-f-]{36}$/i.test(quoteId)) return fail('A current road route is required before booking');
      const { data: rideId, error } = await admin.rpc('consume_google_route_quote', { p_quote_id: quoteId, p_customer_id: userData.user.id, p_ride_type: kind, p_pickup_address: pickupAddress, p_drop_address: dropAddress, p_passenger_count: passengerCount });
      if (error || typeof rideId !== 'string') throw error ?? new Error('Ride request was not created');
      return response({ rideId });
    }

    if (action === 'preview_trip_route') {
      const pickup = coordinate(body?.pickup);
      const drop = coordinate(body?.drop);
      if (!pickup || !drop) return fail('Valid pickup and destination are required');
      const { data: existing, error: existingError } = await admin.rpc('find_google_route_quote', { p_customer_id: userData.user.id, p_pickup_latitude: pickup.latitude, p_pickup_longitude: pickup.longitude, p_drop_latitude: drop.latitude, p_drop_longitude: drop.longitude }).maybeSingle();
      if (existingError) throw existingError;
      // PostgREST can represent a no-row composite RPC result as an empty
      // object/array. Only reuse a record that is demonstrably a saved quote;
      // otherwise compute and persist a fresh Google route.
      if (existing && typeof existing === 'object' && !Array.isArray(existing) && typeof (existing as Record<string, unknown>).id === 'string') {
        const quote = existing as Record<string, unknown>;
        return response({ id: quote.id, distanceMeters: Number(quote.distance_meters), durationSeconds: Number(quote.duration_seconds), encodedPolyline: quote.encoded_polyline });
      }
      const { route, callId } = await computeRoute(pickup, drop, 'initial_trip');
      const { data: quote, error } = await admin.from('google_route_quotes').insert({ customer_id: userData.user.id, pickup_latitude: pickup.latitude, pickup_longitude: pickup.longitude, drop_latitude: drop.latitude, drop_longitude: drop.longitude, distance_meters: route.distanceMeters, duration_seconds: route.durationSeconds, encoded_polyline: route.encodedPolyline, routes_call_id: callId }).select('id').single();
      if (error || !quote) throw error ?? new Error('Route quote was not saved');
      return response({ id: quote.id, ...route });
    }

    if (action === 'accept_offer') {
      const offerId = String(body?.offerId ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(offerId)) return fail('Invalid offer');
      const key = publicKey();
      if (!key) throw new Error('Supabase publishable key is unavailable');
      const caller = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: authorization! } } });
      const { data: ride, error: acceptanceError } = await caller.rpc('respond_to_ride_offer', { p_offer_id: offerId, p_accept: true });
      if (acceptanceError || !ride) throw acceptanceError ?? new Error('Ride offer could not be accepted');
      const acceptedRide = ride as Record<string, unknown>;

      // The database claim is authoritative and must not be reported as failed
      // because optional Maps enrichment is capped or temporarily unavailable.
      // Running it after the claim also avoids spending a route request for a
      // Captain who loses the atomic race.
      try {
        const pickup = coordinate({ latitude: acceptedRide.pickup_latitude, longitude: acceptedRide.pickup_longitude });
        const { data: availability, error: availabilityError } = await admin.from('captain_availability').select('latitude, longitude').eq('captain_id', userData.user.id).single();
        const captain = coordinate({ latitude: availability?.latitude, longitude: availability?.longitude });
        if (availabilityError || !pickup || !captain) throw new Error('Captain location is unavailable; route was not recalculated');
        const { route, callId } = await computeRoute(captain, pickup, 'captain_to_pickup');
        const { error: applyError } = await admin.rpc('apply_captain_road_distance', { p_ride_id: acceptedRide.id, p_pickup_distance_meters: route.distanceMeters, p_duration_seconds: route.durationSeconds, p_encoded_polyline: route.encodedPolyline });
        if (applyError) throw applyError;
        await admin.from('google_routes_call_log').update({ ride_id: acceptedRide.id }).eq('id', callId);
        return response({ ride, route });
      } catch {
        return response({ ride });
      }
    }

    return fail('Unsupported action');
  } catch (error) {
    const message = error instanceof GoogleRoutesDailyCapError ? error.message : error instanceof Error ? error.message : 'Google Maps request failed';
    return fail(message, message.includes('Daily Google') ? 429 : 502);
  }
});
