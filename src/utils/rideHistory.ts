import type { DispatchRide } from '../services/rideDispatch';

export type RideHistoryFilter = 'all' | 'date' | 'month' | 'year';

export function rideHistoryTimestamp(ride: DispatchRide): number {
  const value = ride.completed_at ?? ride.requested_at ?? ride.accepted_at ?? ride.started_at;
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function filterAndSortRideHistory(rides: DispatchRide[], filter: RideHistoryFilter, now = new Date()): DispatchRide[] {
  return [...rides]
    .sort((left, right) => rideHistoryTimestamp(right) - rideHistoryTimestamp(left))
    .filter((ride) => {
      if (filter === 'all') return true;
      const timestamp = rideHistoryTimestamp(ride);
      if (!timestamp) return false;
      const date = new Date(timestamp);
      if (filter === 'date') return date.toDateString() === now.toDateString();
      if (filter === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      return date.getFullYear() === now.getFullYear();
    });
}
