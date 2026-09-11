import { supabase } from './supabase';
import type {
  CancellationBreakdown,
  CaptainPaymentIssue,
  CaptainRollup,
  CustomerPaymentIssue,
  CustomerRollup,
  DailyRideStats,
  EarningsLedgerEntry,
  GoogleRoutesLog,
  OnlineSession,
  PayoutQueueRow,
  PromotionEntitlement,
  Ride,
  RideOffer,
  RideSettlement,
  SettlementQueueRow,
  CaptainRideVerificationRow,
  CaptainSettlementRow,
  CaptainDocumentChangeQueueRow,
  RideGpsEvidence,
} from './types';

export type HealthStatus = 'HEALTHY' | 'NEEDS_ATTENTION' | 'RISK' | 'NOT_OBSERVABLE' | 'PROBE_ERROR';
export interface HealthFinding { service: string; component: string; status: HealthStatus; metric: string; value: string; threshold: string; evidence: string; reason: string; recommendedAlert: { trigger: string; severity: string; reason: string; suggestedResponse: string; baseline?: string } | null; cadence: string; }
export interface HealthAudit { environment: 'production'; observationWindow: '15m' | '1h' | '6h' | '24h'; startedAt: string; completedAt: string; durationMs: number; overall: HealthStatus; counts: Record<HealthStatus, number>; findings: HealthFinding[]; }

export async function runSystemHealthAudit(window: HealthAudit['observationWindow']): Promise<HealthAudit> {
  const { data, error } = await supabase!.functions.invoke('system-health', { body: { window } });
  if (error) throw new Error('Health audit could not complete.');
  const result = data as { data?: HealthAudit } | null;
  if (!result?.data) throw new Error('Health audit could not complete.');
  return result.data;
}

type QueryResult<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

async function unwrap<T>(run: () => QueryResult<T>): Promise<T> {
  const { data, error } = await run();
  if (error) throw new Error(error.message);
  return data as T;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// ---------------------------------------------------------------- Overview

export async function fetchDailyStats(): Promise<DailyRideStats[]> {
  const rows = await unwrap(() =>
    supabase!.from('dashboard_daily_ride_stats').select('*').order('day', { ascending: true }),
  );
  return (rows ?? []) as DailyRideStats[];
}

export async function fetchCancellationBreakdown(): Promise<CancellationBreakdown[]> {
  const rows = await unwrap(() =>
    supabase!.from('dashboard_cancellation_breakdown').select('*').order('day', { ascending: true }),
  );
  return (rows ?? []) as CancellationBreakdown[];
}

export interface LiveRideRow extends Ride {
  customer: { id: string; full_name: string | null; phone: string | null } | null;
  captain_profile: { user_id: string; vehicle_type: string } | null;
}

export async function fetchLiveRides(): Promise<LiveRideRow[]> {
  const rows = await unwrap(() =>
    supabase!
      .from('rides')
      .select(
        '*, customer:profiles!rides_customer_id_fkey(id, full_name, phone), ' +
          'captain_profile:captain_profiles!rides_captain_id_fkey(user_id, vehicle_type)',
      )
      .in('status', ['requested', 'searching', 'accepted', 'arrived', 'in_progress'])
      .order('requested_at', { ascending: false })
      .limit(50),
  ) as unknown as LiveRideRow[];
  return rows ?? [];
}

async function countRows(table: string, column?: string, value?: string): Promise<number> {
  let query = supabase!.from(table).select('1', { count: 'exact', head: true });
  if (column && value) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface OverviewCounts {
  awaitingReview: number;
  flagged: number;
  openCaptainIssues: number;
  customerIssues: number;
}

export async function fetchOverviewCounts(): Promise<OverviewCounts> {
  const [awaitingReview, flagged, openCaptainIssues, customerIssues] = await Promise.all([
    countRows('ride_settlements', 'status', 'awaiting_review'),
    countRows('ride_settlements', 'status', 'flagged'),
    countRows('captain_payment_issues', 'status', 'open'),
    countRows('customer_payment_issues'),
  ]);
  return { awaitingReview, flagged, openCaptainIssues, customerIssues };
}

export async function fetchOnlineCaptains(): Promise<CaptainRollup[]> {
  const rows = await unwrap(() =>
    supabase!.from('dashboard_captain_rollups').select('*').eq('is_online', true).limit(100),
  );
  return (rows ?? []) as CaptainRollup[];
}

// --------------------------------------------------------------- Customers

export async function fetchCustomerRollups(): Promise<CustomerRollup[]> {
  const rows = await unwrap(() =>
    supabase!
      .from('dashboard_customer_rollups')
      .select('*')
      .order('last_ride_at', { ascending: false, nullsFirst: false })
      .limit(500),
  );
  return (rows ?? []) as CustomerRollup[];
}

export interface CustomerDetail {
  rollup: Partial<CustomerRollup>;
  rides: Ride[];
  issues: CustomerPaymentIssue[];
  entitlements: PromotionEntitlement[];
}

export async function fetchCustomerDetail(customerId: string): Promise<CustomerDetail> {
  const [rollupRows, rides, issues, entitlements] = await Promise.all([
    unwrap(() => supabase!.from('dashboard_customer_rollups').select('*').eq('customer_id', customerId)),
    unwrap(() =>
      supabase!.from('rides').select('*').eq('customer_id', customerId).order('requested_at', { ascending: false }).limit(50),
    ),
    unwrap(() =>
      supabase!.from('customer_payment_issues').select('*').eq('customer_id', customerId).order('opened_at', { ascending: false }),
    ),
    unwrap(() =>
      supabase!
        .from('customer_promotion_entitlements')
        .select('*')
        .eq('customer_id', customerId)
        .order('reserved_at', { ascending: false })
        .limit(100),
    ),
  ]);
  return {
    rollup: ((rollupRows ?? []) as CustomerRollup[])[0] ?? {},
    rides: (rides ?? []) as Ride[],
    issues: (issues ?? []) as CustomerPaymentIssue[],
    entitlements: (entitlements ?? []) as PromotionEntitlement[],
  };
}

// ---------------------------------------------------------------- Captains

export async function fetchCaptainRollups(): Promise<CaptainRollup[]> {
  const rows = await unwrap(() =>
    supabase!
      .from('dashboard_captain_rollups')
      .select('*')
      .order('last_ride_at', { ascending: false, nullsFirst: false })
      .limit(500),
  );
  return (rows ?? []) as CaptainRollup[];
}

export interface CaptainDetail {
  rollup: Partial<CaptainRollup>;
  rides: Ride[];
  ledger: EarningsLedgerEntry[];
  sessions: OnlineSession[];
  offers: RideOffer[];
}

export async function fetchCaptainDetail(captainId: string): Promise<CaptainDetail> {
  const [rollupRows, rides, ledger, sessions, offers] = await Promise.all([
    unwrap(() => supabase!.from('dashboard_captain_rollups').select('*').eq('captain_id', captainId)),
    unwrap(() =>
      supabase!.from('rides').select('*').eq('captain_id', captainId).order('requested_at', { ascending: false }).limit(50),
    ),
    unwrap(() =>
      supabase!
        .from('captain_earnings_ledger')
        .select('*')
        .eq('captain_id', captainId)
        .order('occurred_at', { ascending: false })
        .limit(200),
    ),
    unwrap(() =>
      supabase!
        .from('captain_online_sessions')
        .select('*')
        .eq('captain_id', captainId)
        .order('started_at', { ascending: false })
        .limit(30),
    ),
    unwrap(() =>
      supabase!.from('ride_offers').select('*').eq('captain_id', captainId).order('offered_at', { ascending: false }).limit(200),
    ),
  ]);
  return {
    rollup: ((rollupRows ?? []) as CaptainRollup[])[0] ?? {},
    rides: (rides ?? []) as Ride[],
    ledger: (ledger ?? []) as EarningsLedgerEntry[],
    sessions: (sessions ?? []) as OnlineSession[],
    offers: (offers ?? []) as RideOffer[],
  };
}

// ---------------------------------------------------------------- Payments

export type SettlementStatusFilter = 'awaiting_review' | 'confirmed' | 'flagged';

export async function fetchSettlementQueue(status: SettlementStatusFilter | 'all'): Promise<SettlementQueueRow[]> {
  const rows = await unwrap(() =>
    supabase!.rpc('operator_settlement_queue', { p_status: status === 'all' ? null : status }),
  );
  return (rows ?? []) as SettlementQueueRow[];
}

export function reviewSettlement(settlementId: string, action: 'confirmed' | 'flagged', note?: string) {
  return unwrap(() =>
    supabase!.rpc('operator_review_settlement', {
      p_settlement_id: settlementId,
      p_action: action,
      p_note: note ?? null,
    }),
  );
}

export async function fetchPayoutQueue(status?: string): Promise<PayoutQueueRow[]> {
  const rows = await unwrap(() => supabase!.rpc('operator_captain_payout_queue', { p_status: status ?? null }));
  return (rows ?? []) as PayoutQueueRow[];
}

export function updatePayout(payoutId: string, status: string, note: string, providerReference?: string) {
  return unwrap(() =>
    supabase!.rpc('operator_update_captain_payout', {
      p_payout_id: payoutId,
      p_status: status,
      p_note: note,
      p_provider_reference: providerReference || null,
    }),
  );
}

export function holdPayout(payoutId: string, reason: string, note: string) {
  return unwrap(() =>
    supabase!.rpc('operator_hold_captain_payout', {
      p_payout_id: payoutId,
      p_reason: reason,
      p_note: note,
    }),
  );
}

export function resolvePayoutDispute(disputeId: string, status: 'resolved' | 'rejected', note: string) {
  return unwrap(() =>
    supabase!.rpc('operator_resolve_captain_payout_dispute', {
      p_dispute_id: disputeId,
      p_status: status,
      p_note: note,
    }),
  );
}

export function resolveCaptainIssue(issueId: string, resolutionNote: string) {
  return unwrap(() => supabase!.rpc('operator_resolve_captain_payment_issue', { p_issue_id: issueId, p_resolution_note: resolutionNote }));
}

export interface CaptainPaymentIssueMessage {
  id: string;
  sender_type: 'captain' | 'support';
  body: string;
  created_at: string;
}

export async function fetchCaptainPaymentIssueMessages(issueId: string): Promise<CaptainPaymentIssueMessage[]> {
  return unwrap(() => supabase!.rpc('operator_captain_payment_issue_messages', { p_issue_id: issueId })) as Promise<CaptainPaymentIssueMessage[]>;
}

export function sendCaptainPaymentIssueMessage(issueId: string, body: string) {
  return unwrap(() => supabase!.rpc('operator_send_captain_payment_issue_message', { p_issue_id: issueId, p_body: body }));
}

export interface CustomerPaymentIssueMessage {
  id: string;
  sender_type: 'customer' | 'support';
  body: string;
  created_at: string;
}

export async function fetchCustomerPaymentIssueMessages(issueId: string): Promise<CustomerPaymentIssueMessage[]> {
  return unwrap(() => supabase!.rpc('operator_customer_payment_issue_messages', { p_issue_id: issueId })) as Promise<CustomerPaymentIssueMessage[]>;
}

export function sendCustomerPaymentIssueMessage(issueId: string, body: string) {
  return unwrap(() => supabase!.rpc('operator_send_customer_payment_issue_message', { p_issue_id: issueId, p_body: body }));
}

export function resolveCustomerIssue(issueId: string, resolutionNote: string) {
  return unwrap(() => supabase!.rpc('operator_resolve_customer_payment_issue', { p_issue_id: issueId, p_resolution_note: resolutionNote }));
}

export function resolveDisputeWithAdjustment(source: 'customer' | 'captain', disputeId: string, resolution: 'NO_ACTION' | 'CUSTOMER_LIABLE' | 'CAPTAIN_LIABLE', amount?: number, reason?: string, notes?: string) {
  return unwrap(() => supabase!.rpc('operator_resolve_dispute_with_adjustment', { p_dispute_source: source, p_dispute_id: disputeId, p_resolution: resolution, p_amount: amount ?? null, p_reason: reason ?? null, p_operator_notes: notes ?? null }));
}

export interface DisputeFinancialAdjustment { source_dispute_id: string; account_type: 'CUSTOMER' | 'CAPTAIN'; original_amount: number; applied_amount: number; remaining_amount: number; status: string; source_ride_id: string; created_at: string; created_by_operator: string; }
export async function fetchDisputeFinancialAdjustments(): Promise<DisputeFinancialAdjustment[]> {
  return (await unwrap(() => supabase!.rpc('operator_dispute_financial_adjustments'))) as DisputeFinancialAdjustment[];
}

// ---------------------------------------------------- Captain settlements

export async function fetchCaptainRideVerificationQueue(status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'all' = 'PENDING') {
  const rows = await unwrap(() =>
    supabase!.rpc('operator_captain_ride_verification_queue', { p_status: status === 'all' ? null : status }),
  );
  return (rows ?? []) as CaptainRideVerificationRow[];
}

export async function fetchRideGpsEvidence(rideId: string): Promise<RideGpsEvidence> {
  const rows = await unwrap(() => supabase!.rpc('operator_ride_gps_evidence', { p_ride_id: rideId }));
  const evidence = (rows as RideGpsEvidence[] | null)?.[0];
  if (!evidence) throw new Error('GPS tracking evidence is unavailable for this ride.');
  return evidence;
}

export async function fetchCaptainDocumentChangeQueue(): Promise<CaptainDocumentChangeQueueRow[]> {
  const rows = await unwrap(() => supabase!.rpc('operator_captain_document_change_queue'));
  return (rows ?? []) as CaptainDocumentChangeQueueRow[];
}

export function reviewCaptainDocumentChange(documentId: string, approve: boolean, note?: string) {
  return unwrap(() => supabase!.rpc('operator_review_captain_document_change', {
    p_document_id: documentId,
    p_approve: approve,
    p_note: note?.trim() || null,
  }));
}

export function verifyCaptainDocument(documentId: string, approve: boolean, note?: string) {
  return unwrap(() => supabase!.rpc('operator_verify_captain_document', {
    p_document_id: documentId,
    p_approve: approve,
    p_note: note?.trim() || null,
  }));
}

export async function getCaptainDocumentPreviewUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase!.storage.from('captain-documents').createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Document preview is unavailable');
  return data.signedUrl;
}

export function verifyCaptainRide(compensationId: string, status: 'APPROVED' | 'REJECTED', rejectionReason?: string) {
  return unwrap(() =>
    supabase!.rpc('operator_verify_captain_ride', {
      p_compensation_id: compensationId,
      p_status: status,
      p_rejection_reason: rejectionReason ?? null,
    }),
  );
}

export async function generateCaptainSettlement(settlementDate: string) {
  return unwrap(() => supabase!.rpc('operator_generate_captain_settlement', { p_settlement_date: settlementDate }));
}

export async function fetchCaptainSettlementQueue(settlementDate?: string) {
  const rows = await unwrap(() =>
    supabase!.rpc('operator_captain_settlement_queue', { p_settlement_date: settlementDate ?? null }),
  );
  return (rows ?? []) as CaptainSettlementRow[];
}

export function approveCaptainSettlementBatch(batchId: string) {
  return unwrap(() => supabase!.rpc('operator_approve_captain_settlement_batch', { p_batch_id: batchId }));
}

export function recordManualCaptainPayment(settlementId: string, reference: string, notes?: string) {
  return unwrap(() =>
    supabase!.rpc('operator_record_manual_captain_payment', {
      p_settlement_id: settlementId,
      p_reference: reference,
      p_notes: notes ?? null,
    }),
  );
}

export interface DisputeListRow {
  id: string;
  payout_id: string;
  status: string;
  reason: string;
  operator_note: string | null;
  opened_at: string;
  resolved_at: string | null;
  ride_id: string | null;
}

export async function fetchPayoutDisputes(): Promise<DisputeListRow[]> {
  const rows = await unwrap(() =>
    supabase!
      .from('captain_payout_disputes')
      .select(
        'id, payout_id, status, reason, operator_note, opened_at, resolved_at, payout:captain_payouts(compensation_id)',
      )
      .order('opened_at', { ascending: false })
      .limit(200),
  ) as unknown as Array<Omit<DisputeListRow, 'ride_id'> & { payout: { compensation_id: string } | Array<{ compensation_id: string }> | null }>;

  const compIds = rows
    .map((r) => (Array.isArray(r.payout) ? r.payout[0]?.compensation_id : r.payout?.compensation_id))
    .filter((v): v is string => Boolean(v));
  const rideByCompensation = new Map<string, string>();
  if (compIds.length > 0) {
    const comps = await unwrap(() =>
      supabase!.from('captain_compensations').select('id, ride_id').in('id', [...new Set(compIds)]),
    ) as unknown as Array<{ id: string; ride_id: string }>;
    comps.forEach((c) => rideByCompensation.set(c.id, c.ride_id));
  }
  return rows.map((row) => ({
    ...row,
    ride_id: row.payout
      ? (rideByCompensation.get(Array.isArray(row.payout) ? row.payout[0].compensation_id : row.payout.compensation_id) ?? null)
      : null,
  }));
}

interface IssueRideFacts {
  status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  final_fare: number | null;
}

async function enrichIssues<T extends { ride_id: string }>(issues: T[]): Promise<Map<string, IssueRideFacts>> {
  const rideIds = [...new Set(issues.map((i) => i.ride_id))];
  if (rideIds.length === 0) return new Map();
  const rows = await unwrap(() =>
    supabase!.from('rides').select('id, status, payment_status, payment_method, final_fare').in('id', rideIds),
  ) as unknown as Array<IssueRideFacts & { id: string }>;
  return new Map(rows.map((r) => [r.id, r]));
}

export interface EnrichedCaptainIssue extends CaptainPaymentIssue {
  rideStatus: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  finalFare: number | null;
}

export async function fetchCaptainIssues(): Promise<EnrichedCaptainIssue[]> {
  const issues = await unwrap(() =>
    supabase!.from('captain_payment_issues').select('*').order('opened_at', { ascending: false }).limit(200),
  ) as unknown as CaptainPaymentIssue[];
  const facts = await enrichIssues(issues);
  return issues.map((issue) => ({
    ...issue,
    rideStatus: facts.get(issue.ride_id)?.status ?? null,
    paymentStatus: facts.get(issue.ride_id)?.payment_status ?? null,
    paymentMethod: facts.get(issue.ride_id)?.payment_method ?? null,
    finalFare: facts.get(issue.ride_id)?.final_fare ?? null,
  }));
}

export interface EnrichedCustomerIssue extends CustomerPaymentIssue {
  rideStatus: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  finalFare: number | null;
}

export async function fetchCustomerIssues(): Promise<EnrichedCustomerIssue[]> {
  const issues = await unwrap(() =>
    supabase!.from('customer_payment_issues').select('*').order('opened_at', { ascending: false }).limit(200),
  ) as unknown as CustomerPaymentIssue[];
  const facts = await enrichIssues(issues);
  return issues.map((issue) => ({
    ...issue,
    rideStatus: facts.get(issue.ride_id)?.status ?? null,
    paymentStatus: facts.get(issue.ride_id)?.payment_status ?? null,
    paymentMethod: facts.get(issue.ride_id)?.payment_method ?? null,
    finalFare: facts.get(issue.ride_id)?.final_fare ?? null,
  }));
}

export type UnifiedDisputeSource = 'customer' | 'captain' | 'payout';
export interface UnifiedDispute {
  id: string;
  source: UnifiedDisputeSource;
  ride_id: string | null;
  reason: string;
  status: string;
  opened_at: string;
  resolved_at: string | null;
  operator_note: string | null;
  paymentStatus: string | null;
  paymentMethod: string | null;
  finalFare: number | null;
  financialAdjustment?: DisputeFinancialAdjustment;
}

export async function fetchAllDisputes(): Promise<UnifiedDispute[]> {
  const [payouts, captains, customers, adjustments] = await Promise.all([fetchPayoutDisputes(), fetchCaptainIssues(), fetchCustomerIssues(), fetchDisputeFinancialAdjustments()]);
  const byDispute = new Map(adjustments.map((adjustment) => [adjustment.source_dispute_id, adjustment]));
  return [
    ...payouts.map((issue) => ({ ...issue, source: 'payout' as const, operator_note: issue.operator_note, paymentStatus: null, paymentMethod: null, finalFare: null })),
    ...captains.map((issue) => ({ ...issue, source: 'captain' as const, operator_note: issue.resolution_note, paymentStatus: issue.paymentStatus, paymentMethod: issue.paymentMethod, finalFare: issue.finalFare, financialAdjustment: byDispute.get(issue.id) })),
    ...customers.map((issue) => ({ ...issue, source: 'customer' as const, operator_note: issue.resolution_note, paymentStatus: issue.paymentStatus, paymentMethod: issue.paymentMethod, finalFare: issue.finalFare, financialAdjustment: byDispute.get(issue.id) })),
  ].sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}

// ------------------------------------------------------------------- Fraud

export interface FraudDataset {
  rides: Ride[];
  settlements: RideSettlement[];
  routesLogs: GoogleRoutesLog[];
  maxFreeRides: number;
  maxFreeDistanceMeters: number;
}

export async function fetchFraudDataset(days: number): Promise<FraudDataset> {
  const since = daysAgoIso(days);
  const [rides, settlements, routesLogs, settings] = await Promise.all([
    unwrap(() =>
      supabase!
        .from('rides')
        .select(
          'id, customer_id, captain_id, status, requested_at, completed_at, cancelled_at, cancellation_reason_code, cancellation_reason_detail, estimated_fare, final_fare, pricing_distance_meters, payment_status, payment_method, customer_charge_type, customer_charge_amount, pricing_policy_code, pickup_otp_attempt_count',
        )
        .gte('requested_at', since)
        .order('requested_at', { ascending: false })
        .limit(2000),
    ) as unknown as Ride[],
    unwrap(() =>
      supabase!.from('ride_settlements').select('*').gte('declared_at', since).order('declared_at', { ascending: false }).limit(1000),
    ) as unknown as RideSettlement[],
    unwrap(() =>
      supabase!.from('google_routes_call_log').select('*').gte('requested_at', since).order('requested_at', { ascending: false }).limit(1000),
    ) as unknown as GoogleRoutesLog[],
    unwrap(() =>
      supabase!.from('ride_pricing_settings').select('maximum_free_rides, maximum_free_distance_meters').limit(1),
    ) as unknown as Array<{ maximum_free_rides: number; maximum_free_distance_meters: number }>,
  ]);
  const s = settings?.[0];
  return {
    rides: rides ?? [],
    settlements: settlements ?? [],
    routesLogs: routesLogs ?? [],
    maxFreeRides: s?.maximum_free_rides ?? 5,
    maxFreeDistanceMeters: s?.maximum_free_distance_meters ?? 2000,
  };
}
