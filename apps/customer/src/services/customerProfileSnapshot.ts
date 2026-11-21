import type { CurrentProfile } from './currentProfile';
import type { DispatchRide, ReceivedRating } from './rideDispatch';

export type CustomerProfileSnapshot = {
  profile: CurrentProfile | null;
  rating: ReceivedRating | null;
  rides: DispatchRide[];
};

let snapshot: CustomerProfileSnapshot | null = null;

export function getCustomerProfileSnapshot() {
  return snapshot;
}

export function setCustomerProfileSnapshot(next: CustomerProfileSnapshot) {
  snapshot = next;
}
