import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Card, ErrorBlock, LoadingBlock, PageHeader, StatusBadge } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import {
  fetchAllDisputes,
  fetchCaptainPaymentIssueMessages,
  fetchCustomerPaymentIssueMessages,
  fetchPayoutQueue,
  fetchSettlementQueue,
  holdPayout,
  resolveCaptainIssue,
  resolveCustomerIssue,
  resolveDisputeWithAdjustment,
  resolvePayoutDispute,
  reviewSettlement,
  sendCaptainPaymentIssueMessage,
  sendCustomerPaymentIssueMessage,
  updatePayout,
} from '@/lib/api';
import type { SettlementStatusFilter } from '@/lib/api';
import type { PayoutQueueRow, SettlementQueueRow } from '@/lib/types';
import type { UnifiedDispute } from '@/lib/api';
import type { CaptainPaymentIssueMessage } from '@/lib/api';
import type { CustomerPaymentIssueMessage } from '@/lib/api';
import { formatDateTime, formatFare, titleize } from '@/lib/format';

type Tab = 'settlements' | 'payouts' | 'disputes';

const TABS: Array<[Tab, string]> = [
  ['settlements', 'Settlement queue'],
  ['payouts', 'Payout queue'],
  ['disputes', 'Disputes & issues'],
];

interface Field {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'textarea' | 'select';
  options?: Array<[string, string]>;
}

function ActionDialog({
  title,
  description,
  fields,
  submitLabel,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  title: string;
  description?: string;
  fields: Field[];
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const missing = fields.filter((f) => f.required && !(values[f.key] ?? '').trim());

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 px-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
        <div className="mt-4 space-y-3">
          {fields.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                {f.label}
                {f.required ? ' *' : ''}
              </label>
              {f.type === 'select' ? (
                <select
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">Choose…</option>
                  {(f.options ?? []).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              ) : (
                <input
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>
        {error ? <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            disabled={busy || missing.length > 0}
            onClick={() => onSubmit(values)}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            {busy ? 'Working…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PaymentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'settlements';

  return (
    <>
      <PageHeader title="Payments & Issues" subtitle="Reconciliation queues and reported payment problems" />
      <div className="mb-5 flex gap-1 rounded-xl bg-slate-200/70 p-1 font-medium text-slate-600" style={{ width: 'fit-content' }}>
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setParams(key === 'settlements' ? {} : { tab: key })}
            className={`rounded-lg px-4 py-1.5 text-sm transition-colors ${tab === key ? 'bg-white shadow text-slate-900' : 'hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'settlements' ? <SettlementsTab /> : null}
      {tab === 'payouts' ? <PayoutsTab /> : null}
      {tab === 'disputes' ? <DisputesTab /> : null}
    </>
  );
}

// -------------------------------------------------------------- settlements

function SettlementsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<SettlementStatusFilter>('awaiting_review');
  const [dialog, setDialog] = useState<{ row: SettlementQueueRow; action: 'confirmed' | 'flagged' } | null>(null);

  const queue = useQuery({ queryKey: ['settlement-queue', filter], queryFn: () => fetchSettlementQueue(filter) });
  const mutation = useMutation({
    mutationFn: (args: { settlementId: string; action: 'confirmed' | 'flagged'; note?: string }) =>
      reviewSettlement(args.settlementId, args.action, args.note),
    onSuccess: () => {
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ['settlement-queue'] });
    },
  });

  return (
    <>
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Declared payments awaiting verification</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as SettlementStatusFilter)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="awaiting_review">Awaiting review</option>
            <option value="confirmed">Confirmed</option>
            <option value="flagged">Flagged</option>
            <option value="all">All</option>
          </select>
        </div>
        {queue.isLoading ? (
          <LoadingBlock />
        ) : queue.error ? (
          <ErrorBlock error={queue.error} />
        ) : (
          <DataTable<SettlementQueueRow>
            data={queue.data ?? []}
            columns={[
              { header: 'Declared at', accessorFn: (r) => r.declared_at, cell: (c) => formatDateTime(c.getValue<string>()) },
              { header: 'Customer', accessorFn: (r) => r.customer_name },
              { header: 'Captain', accessorFn: (r) => r.captain_name },
              { header: 'Route', accessorFn: (r) => `${r.pickup_address} → ${r.drop_address}`, enableSorting: false },
              { header: 'Method', accessorFn: (r) => titleize(r.declared_method) },
              { header: 'Amount due', accessorFn: (r) => Number(r.amount_due), cell: (c) => formatFare(c.getValue<number>()) },
              { header: 'Status', accessorFn: (r) => r.settlement_status, cell: (c) => <StatusBadge value={c.getValue<string>()} /> },
              {
                header: '',
                id: 'actions',
                enableSorting: false,
                cell: (c) =>
                  c.row.original.settlement_status === 'awaiting_review' ? (
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setDialog({ row: c.row.original, action: 'confirmed' })}
                        className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setDialog({ row: c.row.original, action: 'flagged' })}
                        className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500"
                      >
                        Flag
                      </button>
                    </div>
                  ) : null,
              },
            ]}
            emptyMessage="Nothing in this queue."
          />
        )}
      </Card>

      {dialog ? (
        <ActionDialog
          title={dialog.action === 'confirmed' ? 'Confirm payment received' : 'Flag settlement'}
          description={`${formatFare(Number(dialog.row.amount_due))} declared by ${dialog.row.customer_name} via ${dialog.row.declared_method.toUpperCase()} · ride ${dialog.row.ride_id.slice(0, 8)}`}
          fields={[{ key: 'note', label: dialog.action === 'confirmed' ? 'Note (optional)' : 'Flag note (required)', type: 'textarea', required: dialog.action === 'flagged' }]}
          submitLabel={dialog.action === 'confirmed' ? 'Confirm' : 'Flag'}
          busy={mutation.isPending}
          error={mutation.error instanceof Error ? mutation.error.message : null}
          onCancel={() => setDialog(null)}
          onSubmit={(values) =>
            mutation.mutate({ settlementId: dialog.row.settlement_id, action: dialog.action, note: values.note })
          }
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ payouts

const PAYOUT_STATUSES: Array<[string, string]> = [
  ['initiated', 'Initiated'],
  ['processing', 'Processing'],
  ['paid', 'Paid'],
  ['failed', 'Failed'],
  ['reversed', 'Reversed'],
];

function PayoutsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<
    | { kind: 'update'; row: PayoutQueueRow }
    | { kind: 'hold'; row: PayoutQueueRow }
    | null
  >(null);

  const queue = useQuery({ queryKey: ['payout-queue', filter], queryFn: () => fetchPayoutQueue(filter || undefined) });
  const updateMutation = useMutation({
    mutationFn: (args: { payoutId: string; status: string; note: string; reference?: string }) =>
      updatePayout(args.payoutId, args.status, args.note, args.reference),
    onSuccess: () => {
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ['payout-queue'] });
    },
  });
  const holdMutation = useMutation({
    mutationFn: (args: { payoutId: string; reason: string; note: string }) => holdPayout(args.payoutId, args.reason, args.note),
    onSuccess: () => {
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ['payout-queue'] });
    },
  });

  return (
    <>
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Captain payouts</h2>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
          >
            <option value="">All statuses</option>
            {[['not_started', 'Not started'], ...PAYOUT_STATUSES, ['held', 'Held']].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {queue.isLoading ? (
          <LoadingBlock />
        ) : queue.error ? (
          <ErrorBlock error={queue.error} />
        ) : (
          <DataTable<PayoutQueueRow>
            data={queue.data ?? []}
            columns={[
              { header: 'Ride', accessorFn: (r) => r.ride_id, cell: (c) => <code className="rounded bg-slate-100 px-1 text-xs">{String(c.getValue()).slice(0, 8)}</code> },
              { header: 'Earning', accessorFn: (r) => Number(r.captain_earning_amount), cell: (c) => formatFare(c.getValue<number>()) },
              { header: 'Charged', accessorFn: (r) => Number(r.customer_charge_amount), cell: (c) => formatFare(c.getValue<number>()) },
              { header: 'Status', accessorFn: (r) => r.payout_status, cell: (c) => <StatusBadge value={c.getValue<string>()} /> },
              { header: 'Provider', accessorFn: (r) => r.provider ?? '—' },
              { header: 'Reference', accessorFn: (r) => r.provider_reference ?? '—' },
              {
                header: 'Dispute',
                accessorFn: (r) => r.dispute_status,
                cell: (c) => (c.getValue<string>() ? <Badge tone="red">{titleize(c.getValue<string>())}</Badge> : '—'),
              },
              {
                header: '',
                id: 'actions',
                enableSorting: false,
                cell: (c) => {
                  const row = c.row.original;
                  if (row.payout_status === 'paid') return null;
                  return (
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setDialog({ kind: 'update', row })}
                        className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700"
                      >
                        Update
                      </button>
                      <button
                        onClick={() => setDialog({ kind: 'hold', row })}
                        className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-400"
                      >
                        Hold
                      </button>
                    </div>
                  );
                },
              },
            ]}
            emptyMessage="No payouts in this view."
          />
        )}
      </Card>

      {dialog?.kind === 'update' ? (
        <ActionDialog
          title="Update payout status"
          description={`Ride ${dialog.row.ride_id.slice(0, 8)} · earning ${formatFare(Number(dialog.row.captain_earning_amount))}. Marking paid requires a provider/manual reference.`}
          fields={[
            { key: 'status', label: 'New status', type: 'select', required: true, options: PAYOUT_STATUSES },
            { key: 'note', label: 'Operator note (required)', type: 'textarea', required: true },
            { key: 'reference', label: 'Provider / manual reference' },
          ]}
          submitLabel="Apply update"
          busy={updateMutation.isPending}
          error={updateMutation.error instanceof Error ? updateMutation.error.message : null}
          onCancel={() => setDialog(null)}
          onSubmit={(values) =>
            updateMutation.mutate({
              payoutId: dialog.row.payout_id,
              status: values.status,
              note: values.note,
              reference: values.reference,
            })
          }
        />
      ) : null}

      {dialog?.kind === 'hold' ? (
        <ActionDialog
          title="Hold payout"
          description={`Opens a dispute and blocks payment until resolved · ride ${dialog.row.ride_id.slice(0, 8)}`}
          fields={[
            { key: 'reason', label: 'Hold reason (required)', type: 'textarea', required: true },
            { key: 'note', label: 'Operator note (required)', type: 'textarea', required: true },
          ]}
          submitLabel='Place hold'
          busy={holdMutation.isPending}
          error={holdMutation.error instanceof Error ? holdMutation.error.message : null}
          onCancel={() => setDialog(null)}
          onSubmit={(values) => holdMutation.mutate({ payoutId: dialog.row.payout_id, reason: values.reason, note: values.note })}
        />
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------- disputes

function CaptainSupportChatDialog({ issue, onClose }: { issue: UnifiedDispute; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const messages = useQuery({ queryKey: ['captain-payment-issue-messages', issue.id], queryFn: () => fetchCaptainPaymentIssueMessages(issue.id), refetchInterval: 10_000 });
  const send = useMutation({
    mutationFn: () => sendCaptainPaymentIssueMessage(issue.id, body.trim()),
    onSuccess: () => { setBody(''); void queryClient.invalidateQueries({ queryKey: ['captain-payment-issue-messages', issue.id] }); },
  });
  useEffect(() => { setBody(''); }, [issue.id]);
  const rows = (messages.data ?? []) as CaptainPaymentIssueMessage[];
  return <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 px-4" onClick={onClose}><div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-900">Captain support chat</h3><p className="mt-1 text-xs text-slate-500">Ride {issue.ride_id?.slice(0, 8) ?? '—'} · {issue.reason}</p></div><button onClick={onClose} className="rounded px-2 py-1 text-sm text-slate-500">Close</button></div><div className="mt-4 min-h-32 flex-1 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">{messages.isLoading ? <p className="text-sm text-slate-500">Loading messages…</p> : messages.error ? <p className="text-sm text-rose-600">Could not load messages.</p> : rows.length ? rows.map((message) => <div key={message.id} className={message.sender_type === 'support' ? 'ml-8 rounded-lg bg-indigo-100 p-2.5 text-sm' : 'mr-8 rounded-lg bg-white p-2.5 text-sm shadow-sm'}><p className="mb-1 text-xs font-semibold text-slate-500">{message.sender_type === 'support' ? 'Support' : 'Captain'} · {formatDateTime(message.created_at)}</p><p className="whitespace-pre-wrap text-slate-800">{message.body}</p></div>) : <p className="text-sm text-slate-500">No messages yet.</p>}</div><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder="Write a reply to the Captain" className="mt-3 w-full rounded-lg border border-slate-300 p-2 text-sm" /><div className="mt-3 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm">Cancel</button><button disabled={send.isPending || !body.trim()} onClick={() => send.mutate()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{send.isPending ? 'Sending…' : 'Send reply'}</button></div>{send.error ? <p className="mt-2 text-sm text-rose-600">{send.error instanceof Error ? send.error.message : 'Could not send reply.'}</p> : null}</div></div>;
}

function CustomerSupportChatDialog({ issue, onClose }: { issue: UnifiedDispute; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const messages = useQuery({ queryKey: ['customer-payment-issue-messages', issue.id], queryFn: () => fetchCustomerPaymentIssueMessages(issue.id), refetchInterval: 10_000 });
  const send = useMutation({ mutationFn: () => sendCustomerPaymentIssueMessage(issue.id, body.trim()), onSuccess: () => { setBody(''); void queryClient.invalidateQueries({ queryKey: ['customer-payment-issue-messages', issue.id] }); } });
  useEffect(() => { setBody(''); }, [issue.id]);
  const rows = (messages.data ?? []) as CustomerPaymentIssueMessage[];
  return <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 px-4" onClick={onClose}><div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-900">Customer support chat</h3><p className="mt-1 text-xs text-slate-500">The first reply assigns this issue to you · Ride {issue.ride_id?.slice(0, 8) ?? '—'} · {issue.reason}</p></div><button onClick={onClose} className="rounded px-2 py-1 text-sm text-slate-500">Close</button></div><div className="mt-4 min-h-32 flex-1 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">{messages.isLoading ? <p className="text-sm text-slate-500">Loading messages…</p> : messages.error ? <p className="text-sm text-rose-600">Could not load messages.</p> : rows.length ? rows.map((message) => <div key={message.id} className={message.sender_type === 'support' ? 'ml-8 rounded-lg bg-indigo-100 p-2.5 text-sm' : 'mr-8 rounded-lg bg-white p-2.5 text-sm shadow-sm'}><p className="mb-1 text-xs font-semibold text-slate-500">{message.sender_type === 'support' ? 'Support' : 'Customer'} · {formatDateTime(message.created_at)}</p><p className="whitespace-pre-wrap text-slate-800">{message.body}</p></div>) : <p className="text-sm text-slate-500">No messages yet.</p>}</div><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder="Write a reply to the Customer" className="mt-3 w-full rounded-lg border border-slate-300 p-2 text-sm" /><div className="mt-3 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm">Cancel</button><button disabled={send.isPending || !body.trim()} onClick={() => send.mutate()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">{send.isPending ? 'Sending…' : 'Send reply'}</button></div>{send.error ? <p className="mt-2 text-sm text-rose-600">{send.error instanceof Error ? send.error.message : 'Could not send reply.'}</p> : null}</div></div>;
}

function DisputesTab() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ dispute: UnifiedDispute; decision: 'resolved' | 'rejected' } | null>(null);
  const [chatIssue, setChatIssue] = useState<UnifiedDispute | null>(null);
  const disputes = useQuery({ queryKey: ['disputes'], queryFn: fetchAllDisputes });
  const resolveMutation = useMutation({
    mutationFn: (args: { dispute: UnifiedDispute; decision: 'resolved' | 'rejected'; note: string; resolution?: 'NO_ACTION' | 'CUSTOMER_LIABLE' | 'CAPTAIN_LIABLE'; amount?: string; reason?: string; internalNotes?: string }) => {
      if (args.dispute.source !== 'payout' && args.decision === 'resolved') return resolveDisputeWithAdjustment(args.dispute.source, args.dispute.id, args.resolution ?? 'NO_ACTION', args.amount ? Number(args.amount) : undefined, args.reason, args.internalNotes || args.note);
      if (args.dispute.source === 'payout') return resolvePayoutDispute(args.dispute.id, args.decision, args.note);
      if (args.dispute.source === 'customer') return resolveCustomerIssue(args.dispute.id, args.note);
      return resolveCaptainIssue(args.dispute.id, args.note);
    },
    onSuccess: () => {
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: ['disputes'] });
      void queryClient.invalidateQueries({ queryKey: ['payout-queue'] });
    },
  });

  if (disputes.isLoading) return <LoadingBlock />;
  if (disputes.error) return <ErrorBlock error={disputes.error} />;

  return (
    <>
      <Card>
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Customer, Captain, and payout disputes</h2>
        </div>
        <DataTable<UnifiedDispute>
          data={disputes.data ?? []}
          columns={[
            { header: 'Opened', accessorFn: (r) => r.opened_at, cell: (c) => formatDateTime(c.getValue<string>()) },
            { header: 'Source', accessorFn: (r) => r.source, cell: (c) => <Badge tone={c.getValue<string>() === 'customer' ? 'blue' : c.getValue<string>() === 'captain' ? 'amber' : 'red'}>{titleize(c.getValue<string>())}</Badge> },
            { header: 'Ride', accessorFn: (r) => r.ride_id ?? '—', cell: (c) => <code className="rounded bg-slate-100 px-1 text-xs">{String(c.getValue()).slice(0, 8)}</code> },
            { header: 'Reason', accessorFn: (r) => r.reason },
            { header: 'Ride payment', accessorFn: (r) => r.paymentStatus ? `${r.paymentMethod ?? '—'} / ${r.paymentStatus}` : '—' },
            { header: 'Operator note', accessorFn: (r) => r.operator_note ?? '—' },
            { header: 'Adjustment', accessorFn: (r) => r.financialAdjustment, cell: (c) => { const a = c.getValue<UnifiedDispute['financialAdjustment']>(); return a ? <span>{formatFare(Number(a.original_amount))} · applied {formatFare(Number(a.applied_amount))} · remaining {formatFare(Number(a.remaining_amount))} · {titleize(a.status)}</span> : '—'; } },
            { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge value={c.getValue<string>()} /> },
            { header: 'Resolved', accessorFn: (r) => r.resolved_at, cell: (c) => (c.getValue<string>() ? formatDateTime(c.getValue<string>()) : '—') },
            {
              header: '',
              id: 'actions',
              enableSorting: false,
              cell: (c) => {
                const row = c.row.original;
                if (!['open', 'under_review'].includes(row.status)) return null;
                if (row.source !== 'payout') return <div className="flex justify-end gap-1.5">{row.source === 'captain' || row.source === 'customer' ? <button onClick={() => setChatIssue(row)} className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-500">Chat</button> : null}<button onClick={() => setDialog({ dispute: row, decision: 'resolved' })} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500">Resolve</button></div>;
                return (
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => setDialog({ dispute: row, decision: 'resolved' })}
                      className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={() => setDialog({ dispute: row, decision: 'rejected' })}
                      className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500"
                    >
                      Reject
                    </button>
                  </div>
                );
              },
            },
          ]}
          emptyMessage="No customer, Captain, or payout disputes."
        />
      </Card>

      {dialog ? (
        <ActionDialog
          title={dialog.decision === 'resolved' ? 'Resolve dispute' : 'Reject dispute'}
          description={dialog.dispute.reason}
          fields={dialog.decision === 'resolved' && dialog.dispute.source !== 'payout' ? [{ key: 'resolution', label: 'Financial action', type: 'select', required: true, options: [['NO_ACTION', 'No financial adjustment'], ['CUSTOMER_LIABLE', 'Customer liable'], ['CAPTAIN_LIABLE', 'Captain liable']] }, { key: 'amount', label: 'Amount ₹ (required for liability)' }, { key: 'reason', label: 'Reason (required for liability)' }, { key: 'internalNotes', label: 'Internal notes (optional)', type: 'textarea' }] : [{ key: 'note', label: 'Operator note (required)', type: 'textarea', required: true }]}
          submitLabel={dialog.decision === 'resolved' && dialog.dispute.source !== 'payout' ? 'Resolve dispute & create adjustment' : 'Submit'}
          busy={resolveMutation.isPending}
          error={resolveMutation.error instanceof Error ? resolveMutation.error.message : null}
          onCancel={() => setDialog(null)}
          onSubmit={(values) => { const liable = values.resolution === 'CUSTOMER_LIABLE' || values.resolution === 'CAPTAIN_LIABLE'; if (liable && (!values.amount?.trim() || !values.reason?.trim())) return; resolveMutation.mutate({ dispute: dialog.dispute, decision: dialog.decision, note: values.note, resolution: values.resolution as 'NO_ACTION' | 'CUSTOMER_LIABLE' | 'CAPTAIN_LIABLE' | undefined, amount: values.amount, reason: values.reason, internalNotes: values.internalNotes }); }}
        />
      ) : null}
      {chatIssue?.source === 'captain' ? <CaptainSupportChatDialog issue={chatIssue} onClose={() => setChatIssue(null)} /> : null}
      {chatIssue?.source === 'customer' ? <CustomerSupportChatDialog issue={chatIssue} onClose={() => setChatIssue(null)} /> : null}
    </>
  );
}
