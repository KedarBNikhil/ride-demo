import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, ErrorBlock, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { fetchCaptainDetail, fetchPayoutQueue } from '@/lib/api';
import type { EarningsLedgerEntry, OnlineSession, Ride } from '@/lib/types';
import { formatDateTime, formatDuration, formatFare, titleize } from '@/lib/format';

export function CaptainDetailPage() {
  const { captainId = '' } = useParams();
  const detail = useQuery({ queryKey: ['captain-detail', captainId], queryFn: () => fetchCaptainDetail(captainId) });
  const payouts = useQuery({ queryKey: ['payout-queue'], queryFn: () => fetchPayoutQueue() });

  if (detail.isLoading) return <LoadingBlock label="Loading captain…" />;
  if (detail.error) return <ErrorBlock error={detail.error} />;

  const { rollup, rides, ledger, sessions, offers } = detail.data!;
  const captainPayouts = (payouts.data ?? []).filter((p) => p.captain_id === captainId);
  const acceptRate = offers.length ? Math.round((offers.filter((o) => o.status === 'accepted').length / offers.length) * 100) : null;
  const avgRating = (() => {
    const rated = rides.filter((r) => r.captain_rating !== null);
    return rated.length ? (rated.reduce((s, r) => s + (r.captain_rating ?? 0), 0) / rated.length).toFixed(1) : '—';
  })();

  return (
    <>
      <PageHeader
        title={rollup.full_name ?? 'Unnamed captain'}
        subtitle={`${rollup.phone ?? 'no phone'} · ${titleize(rollup.vehicle_type)} · signed up ${formatDateTime(rollup.signed_up_at ?? null)}`}
        actions={
          <Link to="/captains" className="text-sm font-medium text-indigo-600 hover:underline">
            ← All captains
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Rides completed" value={rollup.rides_completed ?? 0} tone="good" />
        <StatCard label="Cancelled" value={rollup.rides_cancelled ?? 0} />
        <StatCard
          label="Offer accept rate"
          value={acceptRate !== null ? `${acceptRate}%` : '—'}
          hint={`${offers.length} offers`}
          tone={acceptRate !== null && acceptRate < 40 ? 'warn' : 'default'}
        />
        <StatCard label="Lifetime earnings" value={formatFare(Number(rollup.lifetime_earnings ?? 0))} />
        <StatCard label="Online time" value={formatDuration(Number(rollup.online_minutes ?? 0))} hint={rollup.is_online ? 'currently online' : undefined} tone={rollup.is_online ? 'good' : 'default'} />
        <StatCard label="Avg rating received" value={avgRating} />
      </div>

      {captainPayouts.length > 0 ? (
        <div className="mb-6">
          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Payouts ({captainPayouts.length})</h2>
            </div>
            <DataTable
              data={captainPayouts}
              columns={[
                { header: 'Ride', accessorKey: 'ride_id', cell: (c) => <code className="rounded bg-slate-100 px-1 text-xs">{String(c.getValue()).slice(0, 8)}</code> },
                { header: 'Earning', accessorKey: 'captain_earning_amount', cell: (c) => formatFare(Number(c.getValue())) },
                { header: 'Status', accessorKey: 'payout_status', cell: (c) => <StatusBadge value={String(c.getValue())} /> },
                { header: 'Provider', accessorFn: (r) => r.provider ?? '—' },
                { header: 'Reference', accessorFn: (r) => r.provider_reference ?? '—' },
                {
                  header: 'Dispute',
                  accessorFn: (r) => r.dispute_status,
                  cell: (c) =>
                    c.getValue<string>() ? (
                      <Badge tone="red">{titleize(c.getValue<string>())}: {c.row.original.dispute_reason?.slice(0, 60)}</Badge>
                    ) : (
                      '—'
                    ),
                },
              ]}
            />
          </Card>
        </div>
      ) : null}

      <div className="space-y-6">
        <Card>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Earnings ledger ({ledger.length})</h2>
          </div>
          <DataTable<EarningsLedgerEntry>
            data={ledger}
            initialSorting={[{ id: 'occurred_at', desc: true }]}
            columns={[
              { header: 'When', accessorKey: 'occurred_at', cell: (c) => formatDateTime(c.getValue<string>()) },
              { header: 'Type', accessorKey: 'entry_type', cell: (c) => <Badge tone="violet">{titleize(c.getValue<string>())}</Badge> },
              { header: 'Amount', accessorFn: (e) => Number(e.amount), cell: (c) => formatFare(c.getValue<number>()) },
              { header: 'Ride', accessorFn: (e) => e.ride_id, cell: (c) => (c.getValue<string>() ? <code className="rounded bg-slate-100 px-1 text-xs">{c.getValue<string>().slice(0, 8)}</code> : '—') },
              { header: 'Note', accessorKey: 'note' },
            ]}
            emptyMessage="No earnings recorded."
          />
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Recent online sessions</h2>
            </div>
            <DataTable<OnlineSession>
              data={sessions}
              columns={[
                { header: 'Started', accessorKey: 'started_at', cell: (c) => formatDateTime(c.getValue<string>()) },
                { header: 'Ended', accessorFn: (s) => s.ended_at, cell: (c) => (c.getValue<string>() ? formatDateTime(c.getValue<string>()) : <Badge tone="green">active now</Badge>) },
                { header: 'End reason', accessorFn: (s) => s.end_reason, cell: (c) => titleize(c.getValue<string>()) },
              ]}
              emptyMessage="No online sessions."
            />
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Recent rides ({rides.length})</h2>
            </div>
            <DataTable<Ride>
              data={rides}
              columns={[
                { header: 'Requested', accessorKey: 'requested_at', cell: (c) => formatDateTime(c.getValue<string>()) },
                { header: 'Route', accessorFn: (r) => `${r.pickup_address} → ${r.drop_address}`, enableSorting: false },
                { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge value={c.getValue<string>()} /> },
                { header: 'Earned', accessorFn: (r) => Number(r.final_fare ?? r.estimated_fare), cell: (c) => formatFare(c.getValue<number>()) },
              ]}
              emptyMessage="No rides assigned yet."
            />
          </Card>
        </div>
      </div>
    </>
  );
}
