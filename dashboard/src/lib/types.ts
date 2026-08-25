export type RideStatus =
  | 'requested'
  | 'searching'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type PaymentStatus = 'pending' | 'declared' | 'confirmed' | 'not_required';
export type ChargeType = 'free' | 'standard';
export type PaymentMethod = 'cash' | 'upi';

export interface Profile {
  id: string;
  phone: string | null;
  full_name: string | null;
  preferred_language: string;
  created_at: string;
  updated_at: string;
}

export interface Ride {
  id: string;
  customer_id: string;
  captain_id: string | null;
  ride_type: 'bike' | 'auto';
  status: RideStatus;
  requested_at: string;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  pickup_address: string;
  drop_address: string;
  travelled_distance_km: number;
  passenger_count: number;
  estimated_fare: number;
  final_fare: number | null;
  base_fare: number | null;
  distance_surcharge: number | null;
  pickup_surcharge: number | null;
  pricing_distance_meters: number | null;
  trip_distance_meters: number | null;
  fare_approval_status: 'estimated' | 'pending' | 'approved' | 'declined';
  cancellation_reason_code: string | null;
  cancellation_reason_detail: string | null;
  cancellation_charge: number;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  customer_charge_amount: number;
  customer_charge_type: ChargeType;
  customer_charge_status: 'pending' | 'not_required' | 'declared' | 'confirmed';
  pricing_policy_code: string | null;
  free_ride_sequence: number | null;
  customer_rating: number | null;
  captain_rating: number | null;
  pickup_otp_attempt_count?: number;
  created_at: string;
}

export interface CaptainProfile {
  user_id: string;
  vehicle_type: 'bike' | 'auto';
  created_at: string;
  updated_at: string;
}

export interface DailyRideStats {
  day: string;
  requested_count: number;
  completed_count: number;
  cancelled_count: number;
  completed_fare_total: number;
  avg_final_fare: number;
  free_rides: number;
  completed_distance_meters: number;
}

export interface CancellationBreakdown {
  day: string;
  reason_code: string;
  actor_type: 'customer' | 'captain' | 'system' | 'unknown';
  cancellation_count: number;
}

export interface CustomerRollup {
  customer_id: string;
  phone: string | null;
  full_name: string | null;
  signed_up_at: string;
  rides_requested: number;
  rides_completed: number;
  rides_cancelled: number;
  total_spend: number;
  free_rides_completed: number;
  last_ride_at: string | null;
  payment_issues_raised: number;
  captain_issues_against: number;
}

export interface CaptainRollup {
  captain_id: string;
  phone: string | null;
  full_name: string | null;
  signed_up_at: string;
  vehicle_type: 'bike' | 'auto';
  onboarding_status: 'draft' | 'submitted' | 'approved' | 'rejected' | null;
  is_online: boolean | null;
  presence_updated_at: string | null;
  rides_assigned: number;
  rides_completed: number;
  rides_cancelled: number;
  lifetime_earnings: number;
  online_minutes: number;
  offers_received: number;
  offers_accepted: number;
  last_ride_at: string | null;
  open_payment_issues: number;
}

export type SettlementStatus = 'awaiting_review' | 'confirmed' | 'flagged';

export interface RideSettlement {
  id: string;
  ride_id: string;
  declared_method: PaymentMethod;
  amount_due: number;
  status: SettlementStatus;
  declared_by: string;
  declared_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface SettlementQueueRow {
  settlement_id: string;
  ride_id: string;
  declared_method: PaymentMethod;
  amount_due: number;
  settlement_status: SettlementStatus;
  declared_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  pickup_address: string;
  drop_address: string;
  customer_name: string;
  captain_name: string;
}

export type PayoutStatus =
  | 'not_started'
  | 'initiated'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'reversed'
  | 'held';

export interface PayoutQueueRow {
  payout_id: string;
  ride_id: string;
  captain_id: string;
  captain_earning_amount: number;
  customer_charge_amount: number;
  payout_status: PayoutStatus;
  provider: string | null;
  provider_reference: string | null;
  dispute_status: 'open' | 'under_review' | 'resolved' | 'rejected' | null;
  dispute_reason: string | null;
}

export interface CaptainPayoutDispute {
  id: string;
  payout_id: string;
  status: 'open' | 'under_review' | 'resolved' | 'rejected';
  reason: string;
  operator_note: string | null;
  opened_by: string | null;
  opened_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
}

export type CaptainIssueReason =
  | 'customer_did_not_pay'
  | 'payment_method_mismatch'
  | 'upi_not_received'
  | 'cash_not_received'
  | 'other';

export type CustomerIssueReason =
  | 'paid_but_not_received'
  | 'incorrect_fare'
  | 'upi_problem'
  | 'cash_dispute'
  | 'other';

export interface CaptainPaymentIssue {
  id: string;
  ride_id: string;
  captain_id: string;
  reason: CaptainIssueReason;
  status: 'open' | 'resolved';
  opened_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface CustomerPaymentIssue {
  id: string;
  ride_id: string;
  customer_id: string;
  reason: CustomerIssueReason;
  opened_at: string;
}

export interface EarningsLedgerEntry {
  id: string;
  captain_id: string;
  ride_id: string | null;
  entry_type: 'ride_earning' | 'tip' | 'bonus' | 'adjustment';
  amount: number;
  occurred_at: string;
  note: string | null;
}

export interface OnlineSession {
  id: string;
  captain_id: string;
  started_at: string;
  ended_at: string | null;
  end_reason: 'offline' | 'accepted_ride' | 'system';
}

export interface PromotionEntitlement {
  id: string;
  customer_id: string;
  ride_id: string;
  policy_code: string;
  sequence: number;
  state: 'reserved' | 'completed' | 'released';
  reserved_at: string;
  completed_at: string | null;
  released_at: string | null;
}

export interface GoogleRoutesLog {
  id: string;
  ride_id: string | null;
  route_kind: string;
  usage_day: string;
  requested_at: string;
  outcome: 'reserved' | 'succeeded' | 'failed';
  http_status: number | null;
  error_code: string | null;
}

export interface RideOffer {
  id: string;
  ride_id: string;
  captain_id: string;
  status: 'offered' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
  offer_round: number;
  offered_at: string;
}
