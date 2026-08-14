import type { LiveCoordinate } from '../components/LiveLocationMap';

/** Ignore small stationary-GPS drift while still updating route origins during meaningful travel. */
export function hasMovedSignificantly(previous: LiveCoordinate | null, next: LiveCoordinate, minimumMeters = 25): boolean {
  if (!previous) return true;
  const radians = Math.PI / 180;
  const latitudeDelta = (next.latitude - previous.latitude) * radians;
  const longitudeDelta = (next.longitude - previous.longitude) * radians;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(previous.latitude * radians) * Math.cos(next.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) >= minimumMeters;
}
