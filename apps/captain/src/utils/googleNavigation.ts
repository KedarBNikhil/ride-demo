import { Linking } from 'react-native';
import type { LiveCoordinate } from '../components/LiveLocationMap';

/** Hands a destination to Google Maps while preserving the in-app ride map. */
export function openGoogleMapsNavigation(destination: LiveCoordinate) {
  const { latitude, longitude } = destination;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`);
}
