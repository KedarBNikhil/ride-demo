import { supabase } from '../lib/supabase';
import type { Coordinate } from '../types/ride';

export type PlaceSuggestion = { placeId: string; text: string };

type MapsResponse<T> = { data?: T; error?: string };

async function describeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const payload = (await context.json()) as MapsResponse<unknown> | null;
      if (payload?.error) return String(payload.error);
    } catch {}
  }
  return error instanceof Error ? error.message : 'Google Maps is unavailable';
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
  const { data, error } = await supabase.functions.invoke('ride-maps', { body });
  if (error) throw new Error(await describeFunctionError(error));
  const payload = data as MapsResponse<T> | null;
  if (!payload?.data) throw new Error(payload?.error ?? 'Google Maps is unavailable');
  return payload.data;
}

export const googleMapsService = {
  autocomplete(input: string, sessionToken: string, languageCode?: string) {
    return invoke<PlaceSuggestion[]>({ action: 'autocomplete', input, sessionToken, languageCode });
  },

  placeDetails(placeId: string, sessionToken: string) {
    return invoke<{ address: string; coordinate: Coordinate }>({ action: 'place_details', placeId, sessionToken });
  },

  geocode(address: string) {
    return invoke<{ address: string; coordinate: Coordinate }>({ action: 'geocode', address });
  },

  reverseGeocode(coordinate: Coordinate) {
    return invoke<{ address: string }>({ action: 'reverse_geocode', coordinate });
  },

  async rideRoute(rideId: string, routeKind: 'initial_trip' | 'captain_to_pickup' | 'trip_started_destination') {
    if (!supabase) throw new Error('SUPABASE_NOT_CONFIGURED');
    const { data, error } = await supabase.from('ride_route_results')
      .select('distance_meters, duration_seconds, encoded_polyline')
      .eq('ride_id', rideId).eq('route_kind', routeKind).maybeSingle();
    if (error || !data) throw error ?? new Error('Route is unavailable');
    return data as { distance_meters: number; duration_seconds: number; encoded_polyline: string };
  },

  async previewTripRoute(pickup: Coordinate, drop: Coordinate) {
    const quote = await invoke<{ id: unknown; distanceMeters: unknown; durationSeconds: unknown; encodedPolyline: unknown }>({ action: 'preview_trip_route', pickup, drop });
    if (
      typeof quote.id !== 'string' || !quote.id ||
      !Number.isFinite(quote.distanceMeters) || (quote.distanceMeters as number) <= 0 ||
      !Number.isFinite(quote.durationSeconds) || (quote.durationSeconds as number) <= 0 ||
      typeof quote.encodedPolyline !== 'string' || !quote.encodedPolyline
    ) {
      const id = typeof quote.id === 'string' && quote.id ? 'present' : 'missing';
      const distance = Number.isFinite(quote.distanceMeters) && (quote.distanceMeters as number) > 0 ? 'present' : 'missing';
      const duration = Number.isFinite(quote.durationSeconds) && (quote.durationSeconds as number) > 0 ? 'present' : 'missing';
      const polyline = typeof quote.encodedPolyline === 'string' && quote.encodedPolyline ? `${quote.encodedPolyline.length} chars` : 'missing';
      throw new Error(`Road route response was incomplete (id ${id}; distance ${distance}; duration ${duration}; polyline ${polyline})`);
    }
    return quote as { id: string; distanceMeters: number; durationSeconds: number; encodedPolyline: string };
  },
};
