import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, ErrorBlock, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import {
  approveCaptainSettlementBatch,
  fetchCaptainRideVerificationQueue,
  fetchCaptainSettlementQueue,
  generateCaptainSettlement,
  recordManualCaptainPayment,
  verifyCaptainRide,
} from '@/lib/api';
import type { CaptainRideVerificationRow, CaptainSettlementRow } from '@/lib/types';
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

export function CaptainSettlementsPage() {
  const queryClient = useQueryClient();
  const [verificationFilter, setVerificationFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'all'>('PENDING');
  const [date, setDate] = useState(localToday);
  const [rejecting, setRejecting] = useState<CaptainRideVerificationRow | null>(null);
  const [paying, setPaying] = useState<CaptainSettlementRow | null>(null);
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
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-slate-800">Company-payable ride verification</h2><select value={verificationFilter} onChange={(e) => setVerificationFilter(e.target.value as typeof verificationFilter)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="all">All</option></select></div><Card>{verifications.isLoading ? <LoadingBlock /> : verifications.error ? <ErrorBlock error={verifications.error} /> : <DataTable<CaptainRideVerificationRow> data={verifications.data ?? []} emptyMessage="No company-payable rides in this view." columns={[
      { header: 'Completed', accessorFn: (r) => r.completed_at, cell: (c) => formatDateTime(c.getValue<string>()) },
      { header: 'Customer / Captain', accessorFn: (r) => `${r.customer_name ?? '—'} / ${r.captain_name ?? '—'}` },
      { header: 'Route', accessorFn: (r) => `${r.pickup_address} → ${r.drop_address}`, enableSorting: false },
      { header: 'Fare / customer charge', accessorFn: (r) => `${formatFare(Number(r.normal_ride_fare))} / ${formatFare(Number(r.customer_charge_amount))}${r.customer_charge_type === 'free' ? ' (free)' : ''}` },
      { header: 'Trip evidence', accessorFn: (r) => `${r.trip_distance_meters ? `${(Number(r.trip_distance_meters) / 1000).toFixed(1)} km` : '—'} · PIN ${r.pickup_otp_verified_at ? 'verified' : '—'}` },
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
  </div>;
}
