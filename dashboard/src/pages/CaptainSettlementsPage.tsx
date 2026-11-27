import { useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, ErrorBlock, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import {
  approveCaptainSettlementBatch,
  fetchCaptainRideVerificationQueue,
  fetchCaptainSettlementQueue,
  fetchRideGpsEvidence,
  generateCaptainSettlement,
  recordManualCaptainPayment,
  verifyCaptainRide,
} from '@/lib/api';
import type { CaptainRideVerificationRow, CaptainSettlementRow, RideGpsEvidence } from '@/lib/types';
import { formatDateTime, formatFare } from '@/lib/format';

const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function PayoutDestination({ settlement }: { settlement: CaptainSettlementRow }) {
  const details = settlement.payout_details;
  if (!settlement.payout_method || !details) return <span className="text-slate-400">Not submitted</span>;
  if (settlement.payout_method === 'upi') return <span>UPI<br /><span className="font-mono text-xs">{details.upi_id ?? '—'}</span></span>;
  return <span>Bank · {details.account_holder ?? '—'}<br /><span className="font-mono text-xs">{details.account_number ?? '—'} · {details.ifsc ?? '—'}</span></span>;
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 px-4" onClick={onClose}><div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><h3 className="text-base font-semibold text-slate-900">{title}</h3>{children}</div></div>;
}

const duration = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${Math.round(seconds)}s`;
function EvidenceBadge({ status }: { status: RideGpsEvidence['tracking_status'] }) {
  const label = status === 'healthy' ? 'Tracking healthy' : status === 'incomplete' ? 'Tracking incomplete' : 'Tracking suspicious';
  const tone = status === 'healthy' ? 'bg-emerald-100 text-emerald-800' : status === 'incomplete' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800';
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}
function GpsTrailPlot({ samples }: { samples: RideGpsEvidence['samples'] }) {
  if (samples.length < 2) return <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">Not enough recorded points to plot a trail.</div>;
  const lats = samples.map((p) => p.latitude); const lngs = samples.map((p) => p.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const spanLat = Math.max(maxLat - minLat, 0.00001), spanLng = Math.max(maxLng - minLng, 0.00001);
  const points = samples.map((p) => `${20 + ((p.longitude - minLng) / spanLng) * 360},${180 - ((p.latitude - minLat) / spanLat) * 160}`).join(' ');
  return <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2"><svg viewBox="0 0 400 200" className="h-48 w-full" role="img" aria-label="Chronological Captain GPS trail"><polyline points={points} fill="none" stroke="#0f766e" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />{samples.map((p, index) => <circle key={`${p.device_recorded_at}-${index}`} cx={20 + ((p.longitude - minLng) / spanLng) * 360} cy={180 - ((p.latitude - minLat) / spanLat) * 160} r={index === 0 || index === samples.length - 1 ? 5 : 3} fill={p.mocked_location ? '#e11d48' : index === 0 ? '#2563eb' : index === samples.length - 1 ? '#16a34a' : '#0f766e'} />)}</svg><div className="flex justify-between px-2 text-xs text-slate-500"><span>First GPS point</span><span>Chronological sampled trail</span><span>Last GPS point</span></div></div>;
}
function GpsEvidenceDialog({ ride, onClose }: { ride: CaptainRideVerificationRow; onClose: () => void }) {
  const evidence = useQuery({ queryKey: ['ride-gps-evidence', ride.ride_id], queryFn: () => fetchRideGpsEvidence(ride.ride_id) });
  return <Dialog title="Ride GPS Trail / Tracking Evidence" onClose={onClose}>{evidence.isLoading ? <LoadingBlock /> : evidence.error ? <ErrorBlock error={evidence.error} /> : evidence.data ? <div className="mt-3 space-y-4"><div className="flex items-center justify-between"><EvidenceBadge status={evidence.data.tracking_status} /><span className="text-xs text-slate-500">{evidence.data.sample_count} samples</span></div>{evidence.data.tracking_reasons.map((reason) => <p key={reason} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{reason}</p>)}<div className="grid grid-cols-2 gap-2 text-sm"><span>Coverage: <b>{Number(evidence.data.coverage_percent).toFixed(1)}%</b></span><span>Largest gap: <b>{duration(evidence.data.largest_gap_seconds)}</b></span><span>Tracked distance: <b>{(Number(evidence.data.tracked_distance_meters) / 1000).toFixed(2)} km</b></span><span>Low accuracy: <b>{evidence.data.low_accuracy_sample_count}</b></span></div><GpsTrailPlot samples={evidence.data.samples} /><div className="max-h-40 overflow-auto rounded-lg border border-slate-200 text-xs"><table className="w-full text-left"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Captured</th><th>Coordinates</th><th>Accuracy</th></tr></thead><tbody>{evidence.data.samples.map((sample, index) => <tr key={`${sample.device_recorded_at}-${index}`} className="border-t border-slate-100"><td className="p-2">{formatDateTime(sample.device_recorded_at)}</td><td>{sample.latitude.toFixed(5)}, {sample.longitude.toFixed(5)}</td><td>{Math.round(sample.accuracy_meters)}m{sample.mocked_location ? ' · mocked' : ''}</td></tr>)}</tbody></table></div></div> : null}</Dialog>;
}

type WalletRow = { credit_id: string; captain_name: string; ride_id: string; amount_paise: number; credit_status: string; created_at: string; review_note: string | null; cashout_id: string | null; cashout_status: string | null; payout_method: string | null; payout_details: Record<string, string> | null; reference: string | null };
function WalletBonusQueue() {
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ['wallet-bonuses'], queryFn: async () => { if (!supabase) throw new Error('Backend not configured'); const { data, error } = await supabase.rpc('operator_wallet_queue'); if (error) throw error; return (data ?? []) as WalletRow[]; } });
  const action = useMutation({ mutationFn: async (args: { name: string; params: Record<string, string> }) => { if (!supabase) throw new Error('Backend not configured'); const { error } = await supabase.rpc(args.name, args.params); if (error) throw error; }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['wallet-bonuses'] }); } });
  const review = (row: WalletRow, decision: 'approved' | 'rejected') => { const note = window.prompt(`Enter the ${decision} review note after checking ride ${row.ride_id}:`); if (note?.trim()) action.mutate({ name: 'operator_wallet_review', params: { p_credit_id: row.credit_id, p_decision: decision, p_note: note.trim() } }); };
  const resolve = (row: WalletRow, decision: 'paid' | 'rejected') => { if (!row.cashout_id) return; const value = window.prompt(decision === 'paid' ? 'Enter the UTR / bank transaction reference after making the transfer:' : 'Enter the reason for rejecting this cash-out request:'); if (value?.trim()) action.mutate({ name: 'operator_wallet_resolve_cashout', params: { p_cashout_id: row.cashout_id, p_decision: decision, p_reference: decision === 'paid' ? value.trim() : '', p_note: decision === 'rejected' ? value.trim() : '' } }); };
  return <section><h2 className="mb-2 text-base font-semibold text-slate-800">Wallet bonus verification and cash-outs</h2><p className="mb-3 text-sm text-slate-500">Review each completed ride before approving its bonus. Transfer requested cash-outs manually and record the UTR; this dashboard does not initiate a payment.</p>{action.error && <ErrorBlock error={action.error} />}<Card>{queue.isLoading ? <LoadingBlock /> : queue.error ? <ErrorBlock error={queue.error} /> : <DataTable<WalletRow> data={queue.data ?? []} emptyMessage="No wallet bonuses yet." columns={[
    { header: 'Captain', accessorFn: r => r.captain_name }, { header: 'Ride ID', accessorFn: r => r.ride_id }, { header: 'Credited', accessorFn: r => r.created_at, cell: c => formatDateTime(c.getValue<string>()) }, { header: 'Bonus', accessorFn: r => r.amount_paise / 100, cell: c => formatFare(c.getValue<number>()) }, { header: 'Status', accessorFn: r => r.credit_status },
    { header: 'Cash-out destination', accessorFn: r => r.payout_method ?? '—', cell: c => { const r=c.row.original; return r.cashout_status === 'requested' ? <span>{r.payout_method}: {r.payout_method === 'upi' ? r.payout_details?.upi_id : `${r.payout_details?.account_holder ?? ''} ${r.payout_details?.account_number ?? ''} ${r.payout_details?.ifsc ?? ''}`}</span> : <span>{r.reference ?? '—'}</span>; } },
    { header: 'Action', id: 'action', cell: c => { const r=c.row.original; return <div className="flex gap-2">{r.credit_status === 'pending' && <><button disabled={action.isPending} onClick={() => review(r, 'approved')} className="rounded bg-emerald-600 px-2 py-1 text-white">Approve</button><button disabled={action.isPending} onClick={() => review(r, 'rejected')} className="rounded bg-rose-600 px-2 py-1 text-white">Reject</button></>}{r.credit_status === 'requested' && <><button disabled={action.isPending} onClick={() => resolve(r, 'paid')} className="rounded bg-emerald-600 px-2 py-1 text-white">Record paid</button><button disabled={action.isPending} onClick={() => resolve(r, 'rejected')} className="rounded bg-rose-600 px-2 py-1 text-white">Reject request</button></>}</div>; } },
  ]} />}</Card></section>;
}

type RazorpayRidePayment = { ride_id: string; customer_name: string | null; captain_name: string | null; pickup_address: string; drop_address: string; fare: number; customer_charge: number; amount_paise: number; payment_status: string; ride_payment_status: string; ride_payment_method: string | null; provider_method: string | null; order_id: string; payment_id: string | null; created_at: string; verified_at: string | null };
function RazorpayPaymentDetails({ payment, onClose }: { payment: RazorpayRidePayment; onClose: () => void }) {
  const earning = useQuery({ queryKey: ['razorpay-ride-earning', payment.ride_id], queryFn: async () => { if (!supabase) throw new Error('Backend not configured'); const { data, error } = await supabase.rpc('operator_razorpay_ride_earning', { p_ride_id: payment.ride_id }); if (error) throw error; return (data as Array<{ captain_earning_amount: number | null }> | null)?.[0]?.captain_earning_amount ?? null; } });
  const confirmed = payment.payment_status === 'verified';
  const conflict = confirmed && payment.ride_payment_status === 'confirmed' && payment.ride_payment_method !== 'razorpay';
  const line = (label: string, value: string, strong = false) => <div className={`flex justify-between gap-4 border-b border-slate-100 py-2.5 ${strong ? 'font-bold text-slate-900' : 'text-slate-700'}`}><span>{label}</span><span className="text-right">{value}</span></div>;
  return <Dialog title="Ride payment breakdown" onClose={onClose}><div className="mt-3 max-h-[70vh] overflow-y-auto text-sm">
    <p className="break-all text-xs text-slate-500">Ride ID: {payment.ride_id}</p>
    <p className="mt-2 text-slate-700">{payment.customer_name ?? 'Customer unavailable'} → {payment.captain_name ?? 'Captain unavailable'}</p>
    <p className="mt-1 text-xs text-slate-500">{payment.pickup_address} → {payment.drop_address}</p>
    {conflict && <p role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-amber-900">Review needed: Razorpay captured a payment, but this ride was separately confirmed as {payment.ride_payment_method ?? 'another method'}. Check for duplicate payment before taking further action.</p>}
    <h4 className="mt-4 font-semibold text-slate-900">Customer payment</h4>
    {line('Ride fare', formatFare(Number(payment.fare)))}
    {line('Customer charge', formatFare(Number(payment.customer_charge)))}
    {line('Payment attempt amount', formatFare(Number(payment.amount_paise) / 100))}
    {line('Customer paid amount', confirmed ? formatFare(Number(payment.amount_paise) / 100) : 'Not confirmed')}
    {line('Payment status', `${payment.payment_status} · ride ${payment.ride_payment_status}`)}
    {line('Ride payment method', payment.ride_payment_method ?? 'Not recorded')}
    {line('Razorpay method', payment.provider_method ?? 'Unavailable')}
    <h4 className="mt-4 font-semibold text-slate-900">Captain earning and charges</h4>
    {earning.isLoading ? <LoadingBlock /> : earning.error ? <ErrorBlock error={earning.error} /> : line('Captain ride earning (recorded)', earning.data == null ? 'Unavailable' : formatFare(Number(earning.data)))}
    {line('Platform fee', 'Not configured')}
    {line('Razorpay charges', 'Not available')}
    {line('GST and other applicable taxes', 'Not configured')}
    {line('Other charges or adjustments', 'Not configured')}
    {line('Amount payable to Captain', 'Not calculated', true)}
    <h4 className="mt-4 font-semibold text-slate-900">Settlement and payout</h4>
    {line('Settlement to Sawaari', 'Not tracked')}
    {line('Captain payout', 'Not tracked')}
    <p className="mt-3 text-xs text-slate-500">Charges, taxes and Captain payable are placeholders until the calculation and payout rules are decided. The recorded ride earning is not a payout confirmation.</p>
    <p className="mt-3 break-all text-xs text-slate-500">Order: {payment.order_id}<br />Payment: {payment.payment_id ?? 'Not recorded'}</p>
  </div><div className="mt-4 flex justify-end"><button onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white">Close</button></div></Dialog>;
}
function RazorpayRidePayments() {
  const [selectedPayment, setSelectedPayment] = useState<RazorpayRidePayment | null>(null);
  const payments = useQuery({ queryKey: ['razorpay-ride-payments'], queryFn: async () => { if (!supabase) throw new Error('Backend not configured'); const { data, error } = await supabase.rpc('operator_razorpay_ride_payments'); if (error) throw error; return (data ?? []) as RazorpayRidePayment[]; } });
  return <section><div className="mb-3"><h2 className="text-base font-semibold text-slate-800">Razorpay ride payments</h2><p className="mt-1 text-sm text-slate-500">Latest 500 payment attempts recorded by Sawaari. A verified customer payment does not confirm settlement to the company or payment to the Captain.</p></div><Card>{payments.isLoading ? <LoadingBlock /> : payments.error ? <ErrorBlock error={payments.error} /> : <DataTable<RazorpayRidePayment> data={payments.data ?? []} onRowClick={setSelectedPayment} emptyMessage="No Razorpay ride payment attempts recorded." columns={[
    { header: 'Created', accessorFn: r => r.created_at, cell: c => formatDateTime(c.getValue<string>()) },
    { header: 'Ride ID', accessorFn: r => r.ride_id },
    { header: 'Customer', accessorFn: r => r.customer_name ?? '—' },
    { header: 'Captain', accessorFn: r => r.captain_name ?? '—' },
    { header: 'Route', accessorFn: r => `${r.pickup_address} → ${r.drop_address}` },
    { header: 'Ride fare', accessorFn: r => Number(r.fare), cell: c => formatFare(c.getValue<number>()) },
    { header: 'Payment amount', accessorFn: r => Number(r.amount_paise) / 100, cell: c => formatFare(c.getValue<number>()) },
    { header: 'Payment status', accessorFn: r => r.payment_status, cell: c => { const r=c.row.original; const conflict=r.payment_status === 'verified' && r.ride_payment_status === 'confirmed' && r.ride_payment_method !== 'razorpay'; return <span>{c.getValue<string>()} · ride {r.ride_payment_status}{conflict && <strong className="block text-amber-700">Payment method conflict</strong>}</span>; } },
    { header: 'Razorpay IDs', accessorFn: r => r.order_id, cell: c => <span className="font-mono text-xs">{c.row.original.order_id}<br />{c.row.original.payment_id ?? 'Payment not recorded'}</span> },
    { header: '', id: 'details', enableSorting: false, cell: c => <button onClick={(event) => { event.stopPropagation(); setSelectedPayment(c.row.original); }} className="whitespace-nowrap rounded-md border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-700">View breakdown</button> },
  ]} />}</Card>{selectedPayment && <RazorpayPaymentDetails payment={selectedPayment} onClose={() => setSelectedPayment(null)} />}</section>;
}

export function CaptainSettlementsPage() {
  const queryClient = useQueryClient();
  const [verificationFilter, setVerificationFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'all'>('PENDING');
  const [date, setDate] = useState(localToday);
  const [rejecting, setRejecting] = useState<CaptainRideVerificationRow | null>(null);
  const [paying, setPaying] = useState<CaptainSettlementRow | null>(null);
  const [evidenceRide, setEvidenceRide] = useState<CaptainRideVerificationRow | null>(null);
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const verifications = useQuery({ queryKey: ['captain-ride-verifications', verificationFilter], queryFn: () => fetchCaptainRideVerificationQueue(verificationFilter) });
  const settlements = useQuery({ queryKey: ['captain-settlements', date], queryFn: () => fetchCaptainSettlementQueue(date) });
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['captain-ride-verifications'] }); void queryClient.invalidateQueries({ queryKey: ['captain-settlements'] }); };
  const verify = useMutation({ mutationFn: (a: { id: string; status: 'APPROVED' | 'REJECTED'; reason?: string }) => verifyCaptainRide(a.id, a.status, a.reason), onSuccess: () => { setRejecting(null); setReason(''); refresh(); } });
  const generate = useMutation({ mutationFn: () => generateCaptainSettlement(date), onSuccess: refresh });
  const approve = useMutation({ mutationFn: approveCaptainSettlementBatch, onSuccess: refresh });
  const pay = useMutation({ mutationFn: (a: { id: string; reference: string; notes: string }) => recordManualCaptainPayment(a.id, a.reference, a.notes), onSuccess: () => { setPaying(null); setReference(''); setNotes(''); refresh(); } });
  const rows = settlements.data ?? [];
  const totals = useMemo(() => ({ liability: rows.reduce((n, r) => n + Number(r.net_amount), 0), unpaid: rows.filter((r) => r.payout_status !== 'PAID').reduce((n, r) => n + Number(r.net_amount), 0), paid: rows.filter((r) => r.payout_status === 'PAID').reduce((n, r) => n + Number(r.net_amount), 0) }), [rows]);
  const batch = rows[0];

  return <div className="space-y-6">
    <PageHeader title="Captain Settlements" subtitle="Verify company-payable rides, create a daily manual payout batch, then record bank references." />
    <WalletBonusQueue />
    <RazorpayRidePayments />
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-slate-800">Company-payable ride verification</h2><select value={verificationFilter} onChange={(e) => setVerificationFilter(e.target.value as typeof verificationFilter)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="all">All</option></select></div><Card>{verifications.isLoading ? <LoadingBlock /> : verifications.error ? <ErrorBlock error={verifications.error} /> : <DataTable<CaptainRideVerificationRow> data={verifications.data ?? []} emptyMessage="No company-payable rides in this view." columns={[
      { header: 'Completed', accessorFn: (r) => r.completed_at, cell: (c) => formatDateTime(c.getValue<string>()) },
      { header: 'Customer / Captain', accessorFn: (r) => `${r.customer_name ?? '—'} / ${r.captain_name ?? '—'}` },
      { header: 'Route', accessorFn: (r) => `${r.pickup_address} → ${r.drop_address}`, enableSorting: false },
      { header: 'Fare / customer charge', accessorFn: (r) => `${formatFare(Number(r.normal_ride_fare))} / ${formatFare(Number(r.customer_charge_amount))}${r.customer_charge_type === 'free' ? ' (free)' : ''}` },
      { header: 'Trip evidence', accessorFn: (r) => `${r.trip_distance_meters ? `${(Number(r.trip_distance_meters) / 1000).toFixed(1)} km` : '—'} · PIN ${r.pickup_otp_verified_at ? 'verified' : '—'}` },
      { header: 'GPS evidence', accessorFn: (r) => r.gps_tracking_status, cell: (c) => <div className="space-y-1"><EvidenceBadge status={c.row.original.gps_tracking_status} /><button onClick={() => setEvidenceRide(c.row.original)} className="block text-xs font-semibold text-indigo-700 underline">View trail ({c.row.original.gps_sample_count}/{c.row.original.gps_expected_samples})</button></div> },
      { header: 'Company payable', accessorFn: (r) => Number(r.total_company_payable), cell: (c) => formatFare(c.getValue<number>()) },
      { header: 'Status', accessorFn: (r) => r.verification_status, cell: (c) => <StatusBadge value={c.getValue<string>()} /> },
      { header: '', id: 'actions', enableSorting: false, cell: (c) => c.row.original.verification_status === 'PENDING' ? <div className="flex justify-end gap-1.5"><button disabled={verify.isPending} onClick={() => verify.mutate({ id: c.row.original.compensation_id, status: 'APPROVED' })} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">Approve</button><button disabled={verify.isPending} onClick={() => setRejecting(c.row.original)} className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">Reject</button></div> : c.row.original.rejection_reason ?? null },
    ]} />}</Card></section>
    <section><PageHeader title="Daily payout batch" subtitle="Only approved, not-yet-settled earnings for the operational date are included." actions={<><input type="date" value={date} max={localToday()} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm" /><button disabled={generate.isPending} onClick={() => generate.mutate()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{generate.isPending ? 'Generating…' : 'Generate settlement'}</button>{batch?.batch_status === 'DRAFT' ? <button disabled={approve.isPending} onClick={() => approve.mutate(batch.batch_id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Approve settlement</button> : null}</>} />
      <div className="mb-4 grid gap-4 md:grid-cols-3"><StatCard label="Company payout liability" value={formatFare(totals.liability)} /><StatCard label="Unpaid settlements" value={formatFare(totals.unpaid)} tone="warn" /><StatCard label="Paid total" value={formatFare(totals.paid)} tone="good" /></div>
      <Card>{settlements.isLoading ? <LoadingBlock /> : settlements.error ? <ErrorBlock error={settlements.error} /> : <DataTable<CaptainSettlementRow> data={rows} emptyMessage="Generate a settlement after approving rides." columns={[
        { header: 'Captain', accessorFn: (r) => r.captain_name ?? r.captain_id.slice(0, 8) }, { header: 'Payout destination', accessorFn: (r) => r.payout_method ?? '', cell: (c) => <PayoutDestination settlement={c.row.original} /> }, { header: 'Approved rides', accessorFn: (r) => r.approved_rides }, { header: 'Gross', accessorFn: (r) => Number(r.gross_amount), cell: (c) => formatFare(c.getValue<number>()) }, { header: 'Adjustments', accessorFn: (r) => Number(r.adjustments), cell: (c) => formatFare(c.getValue<number>()) }, { header: 'Net', accessorFn: (r) => Number(r.net_amount), cell: (c) => formatFare(c.getValue<number>()) }, { header: 'Payout', accessorFn: (r) => r.payout_status, cell: (c) => <StatusBadge value={c.getValue<string>()} /> }, { header: 'Reference', accessorFn: (r) => r.external_reference ?? '—' }, { header: '', id: 'pay', enableSorting: false, cell: (c) => c.row.original.payout_status === 'APPROVED' ? <button onClick={() => setPaying(c.row.original)} className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white">Record manual payment</button> : null },
      ]} />}</Card>
    </section>
    {rejecting ? <Dialog title="Reject completed ride" onClose={() => setRejecting(null)}><p className="mt-1 text-sm text-slate-500">A reason is required and the earning cannot enter a settlement.</p><textarea value={reason} onChange={(e) => setReason(e.target.value)} className="mt-4 w-full rounded-lg border border-slate-300 p-2 text-sm" rows={3} placeholder="Reason" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setRejecting(null)} className="rounded-lg px-3 py-1.5 text-sm">Cancel</button><button disabled={verify.isPending || !reason.trim()} onClick={() => verify.mutate({ id: rejecting.compensation_id, status: 'REJECTED', reason })} className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Reject ride</button></div>{verify.error ? <ErrorBlock error={verify.error} /> : null}</Dialog> : null}
    {paying ? <Dialog title="Record manual payment" onClose={() => setPaying(null)}><p className="mt-1 text-sm text-slate-500">{paying.captain_name ?? 'Captain'} · {formatFare(Number(paying.net_amount))}. A UTR or bank transaction reference is required.</p><input value={reference} onChange={(e) => setReference(e.target.value)} className="mt-4 w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="UTR / bank transaction reference" /><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-3 w-full rounded-lg border border-slate-300 p-2 text-sm" rows={2} placeholder="Notes (optional)" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setPaying(null)} className="rounded-lg px-3 py-1.5 text-sm">Cancel</button><button disabled={pay.isPending || !reference.trim()} onClick={() => pay.mutate({ id: paying.settlement_id, reference, notes })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Mark paid</button></div>{pay.error ? <ErrorBlock error={pay.error} /> : null}</Dialog> : null}
    {evidenceRide ? <GpsEvidenceDialog ride={evidenceRide} onClose={() => setEvidenceRide(null)} /> : null}
  </div>;
}
