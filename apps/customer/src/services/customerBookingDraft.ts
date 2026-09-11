import type { CustomerRide, Coordinate } from '../screens/CustomerScreens';

type RouteLocationTarget = 'pickup' | 'drop';

function hasUsableCoordinate(coordinate: Coordinate | undefined) {
  return Boolean(
    coordinate &&
    Number.isFinite(coordinate.latitude) &&
    Number.isFinite(coordinate.longitude) &&
    Math.abs(coordinate.latitude) <= 90 &&
    Math.abs(coordinate.longitude) <= 180,
  );
}

function hasDisplayableLocation(value: unknown) {
  return typeof value === 'string' && value.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().length > 0;
}

/**
 * A terminal ride is not a new booking. Remove only its server-specific state
 * while retaining the route the customer just selected, cancelled, or retried.
 */
export function toReusableCustomerBookingDraft(ride: CustomerRide): CustomerRide {
  const { id: _rideId, pickupOtp: _pickupOtp, routeQuote: _routeQuote, ...bookingDraft } = ride;
  return bookingDraft;
}

/**
 * Confirmation must use the exact route the customer selected, not shared
 * active-ride state that can be reconciled while navigation is in flight.
 */
export function toCustomerBookingConfirmationSnapshot(ride: CustomerRide, routeQuote: CustomerRide['routeQuote']): CustomerRide {
  const { id: _rideId, pickupOtp: _pickupOtp, ...bookingDraft } = ride;
  return { ...bookingDraft, routeQuote };
}

/** Returns the first location that must be collected before booking. */
export function missingCustomerBookingLocation(ride: CustomerRide): RouteLocationTarget | null {
  if (!hasDisplayableLocation(ride.pickup) || !hasUsableCoordinate(ride.pickupCoordinate)) return 'pickup';
  if (!hasDisplayableLocation(ride.drop) || !hasUsableCoordinate(ride.dropCoordinate)) return 'drop';
  return null;
}

export function hasCompleteCustomerBookingRoute(ride: CustomerRide) {
  return missingCustomerBookingLocation(ride) === null;
}
