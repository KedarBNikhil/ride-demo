import { createClient } from 'npm:@supabase/supabase-js@2';

type RouteKind = 'initial_trip' | 'captain_to_pickup' | 'trip_started_destination' | 'manual_refresh';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Supabase Edge Function service credentials are unavailable');
}

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

export class GoogleRoutesDailyCapError extends Error {
  constructor() {
    super('Daily Google Routes request limit reached. Try again tomorrow.');
    this.name = 'GoogleRoutesDailyCapError';
  }
}

/**
 * Reserve a billable request before calling Google. Do not release a failed
 * reservation: a network failure may still have reached Google and counting
 * it is the safer financial boundary.
 */
export async function reserveGoogleRoutesCall(rideId: string | null, routeKind: RouteKind): Promise<string> {
  const { data, error } = await admin.rpc('reserve_google_routes_call', {
    p_ride_id: rideId,
    p_route_kind: routeKind,
  });
  if (error?.message.includes('GOOGLE_ROUTES_DAILY_CAP_REACHED')) throw new GoogleRoutesDailyCapError();
  if (error || typeof data !== 'string') throw error ?? new Error('Unable to reserve a Google Routes request');
  return data;
}

export async function finishGoogleRoutesCall(
  callId: string,
  succeeded: boolean,
  httpStatus?: number,
  errorCode?: string,
) {
  const { error } = await admin.rpc('finish_google_routes_call', {
    p_call_id: callId,
    p_succeeded: succeeded,
    p_http_status: httpStatus ?? null,
    p_error_code: errorCode ?? null,
  });
  if (error) throw error;
}
