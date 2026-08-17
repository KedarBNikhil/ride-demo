export type FareRideType = 'bike' | 'auto';

export const SOFT_LAUNCH_FARE_RULE_VERSION = 'soft-launch-2026-08-18';

export type FareInput = {
  rideType: FareRideType;
  passengerCount: number;
  tripDistanceMeters: number;
  pickupDistanceMeters?: number | null;
};

export type FareBreakdown = {
  ruleVersion: string;
  rideType: FareRideType;
  passengerCount: number;
  tripDistanceMeters: number;
  pickupDistanceMeters: number | null;
  baseFare: number;
  distanceSurcharge: number;
  pickupSurcharge: number;
  total: number;
};

type FareRule = {
  includedTripMeters: number;
  baseFare: (passengerCount: number) => number;
  distanceBlockMeters: number;
  distanceBlockFare: number;
  pickupFreeMeters: number;
  pickupBlockMeters: number;
  pickupBlockFare: number;
};

const FARE_RULES: Record<FareRideType, FareRule> = {
  auto: {
    includedTripMeters: 2_000,
    baseFare: (passengers) => 25 * (1.5 ** (passengers - 1)),
    distanceBlockMeters: 100,
    distanceBlockFare: 1,
    pickupFreeMeters: 600,
    pickupBlockMeters: 100,
    pickupBlockFare: 1,
  },
  bike: {
    includedTripMeters: 2_000,
    baseFare: () => 20,
    distanceBlockMeters: 100,
    distanceBlockFare: 1,
    pickupFreeMeters: 800,
    pickupBlockMeters: 100,
    pickupBlockFare: 2,
  },
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const blocksOver = (distanceMeters: number, includedMeters: number, blockMeters: number) =>
  Math.ceil(Math.max(0, distanceMeters - includedMeters) / blockMeters);

/**
 * Pure, deterministic soft-launch tariff calculator. Inputs are meters so the
 * caller may use today's straight-line provider or a future Google road route.
 */
export function calculateFare(input: FareInput): FareBreakdown {
  if (!Number.isFinite(input.tripDistanceMeters) || input.tripDistanceMeters < 0) throw new Error('Trip distance must be a non-negative number of meters');
  if (input.pickupDistanceMeters != null && (!Number.isFinite(input.pickupDistanceMeters) || input.pickupDistanceMeters < 0)) throw new Error('Pickup distance must be a non-negative number of meters');
  if (input.rideType === 'auto' && (!Number.isInteger(input.passengerCount) || input.passengerCount < 1 || input.passengerCount > 3)) throw new Error('Auto passenger count must be between 1 and 3');
  if (input.rideType === 'bike' && input.passengerCount !== 1) throw new Error('Bike rides support one passenger');

  const rule = FARE_RULES[input.rideType];
  const baseFare = roundMoney(rule.baseFare(input.passengerCount));
  const distanceSurcharge = roundMoney(blocksOver(input.tripDistanceMeters, rule.includedTripMeters, rule.distanceBlockMeters) * rule.distanceBlockFare);
  const pickupSurcharge = input.pickupDistanceMeters == null ? 0 : roundMoney(blocksOver(input.pickupDistanceMeters, rule.pickupFreeMeters, rule.pickupBlockMeters) * rule.pickupBlockFare);
  return {
    ruleVersion: SOFT_LAUNCH_FARE_RULE_VERSION,
    rideType: input.rideType,
    passengerCount: input.passengerCount,
    tripDistanceMeters: Math.round(input.tripDistanceMeters),
    pickupDistanceMeters: input.pickupDistanceMeters == null ? null : Math.round(input.pickupDistanceMeters),
    baseFare,
    distanceSurcharge,
    pickupSurcharge,
    total: roundMoney(baseFare + distanceSurcharge + pickupSurcharge),
  };
}
