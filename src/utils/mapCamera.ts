import type MapView from 'react-native-maps';

export type MapCoordinate = { latitude: number; longitude: number };

// A local street/neighbourhood view. Keep this semantic constant shared so the
// two apps do not slowly diverge through unrelated magic region values.
export const HOME_LOCATION_DELTA = 0.014;

export function isValidMapCoordinate(value: unknown): value is MapCoordinate {
  if (!value || typeof value !== 'object') return false;
  const coordinate = value as MapCoordinate;
  return Number.isFinite(coordinate.latitude)
    && Number.isFinite(coordinate.longitude)
    && coordinate.latitude >= -90
    && coordinate.latitude <= 90
    && coordinate.longitude >= -180
    && coordinate.longitude <= 180;
}

export function validMapCoordinates(values: readonly (MapCoordinate | null | undefined)[]) {
  return values.filter(isValidMapCoordinate);
}

export function getVisibleMapPadding({ top = 0, bottomSheetHeight = 0, bottomInset = 0, horizontal = 28 }: {
  top?: number;
  bottomSheetHeight?: number;
  bottomInset?: number;
  horizontal?: number;
}) {
  return {
    top: Math.max(24, Math.round(top + 20)),
    right: horizontal,
    bottom: Math.max(28, Math.round(bottomSheetHeight + bottomInset + 24)),
    left: horizontal,
  };
}

export function fitRouteInVisibleViewport(map: MapView | null, coordinates: readonly (MapCoordinate | null | undefined)[], padding: ReturnType<typeof getVisibleMapPadding>) {
  const valid = validMapCoordinates(coordinates);
  if (!map || valid.length < 2) return false;
  map.fitToCoordinates(valid, { animated: true, edgePadding: padding });
  return true;
}

/**
 * `react-native-maps` regions are centered on the entire MapView, not the
 * unobscured section above a sheet. Move the camera south by the covered
 * fraction; the geographically accurate marker then appears in the usable
 * visual centre without altering the coordinate itself.
 */
export function centerCoordinateInVisibleViewport(map: MapView | null, coordinate: MapCoordinate | null | undefined, { mapHeight, visibleHeight, delta = HOME_LOCATION_DELTA, duration = 350 }: {
  mapHeight: number;
  visibleHeight: number;
  delta?: number;
  duration?: number;
}) {
  if (!map || !isValidMapCoordinate(coordinate)) return false;
  const fullHeight = Math.max(1, mapHeight);
  const usableHeight = Math.max(1, Math.min(fullHeight, visibleHeight));
  const latitude = coordinate.latitude - delta * (0.5 - usableHeight / (2 * fullHeight));
  map.animateToRegion({ latitude, longitude: coordinate.longitude, latitudeDelta: delta, longitudeDelta: delta }, duration);
  return true;
}
