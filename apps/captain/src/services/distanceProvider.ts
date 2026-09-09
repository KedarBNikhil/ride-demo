import type { Coordinate } from '../types/ride';

export interface DistanceProvider {
  distanceMeters(origin: Coordinate, destination: Coordinate): Promise<number>;
}

/** Demo-only straight-line map distance. Replace this implementation with the
 * Google Routes API before soft launch; consumers continue to use meters. */
export function straightLineDistanceMeters(origin: Coordinate, destination: Coordinate): number {
    const radians = Math.PI / 180;
    const latitudeDelta = (destination.latitude - origin.latitude) * radians;
    const longitudeDelta = (destination.longitude - origin.longitude) * radians;
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(origin.latitude * radians) * Math.cos(destination.latitude * radians) * Math.sin(longitudeDelta / 2) ** 2;
    return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export const mapDistanceProvider: DistanceProvider = {
  async distanceMeters(origin, destination) {
    return straightLineDistanceMeters(origin, destination);
  },
};
