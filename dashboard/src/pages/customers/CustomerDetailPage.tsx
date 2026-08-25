import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, ErrorBlock, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { fetchCustomerDetail } from '@/lib/api';
import type { Ride } from '@/lib/types';
import { formatDateTime, formatFare, formatKm, titleize } from '@/lib/format';

export function CustomerDetailPage() {
  const { customerId = '' } = useParams();
  const detail = useQuery({ queryKey: ['customer-detail', customerId], queryFn: () => fetchCustomerDetail(customerId) });

  if (detail.isLoading) return <LoadingBlock label="Loading customer…" />;
  if (detail.error) return <ErrorBlock error={detail.error} />;

  const { rollup, rides, issues, entitlements } = detail.data!;
  const completedRides = rides.filter((r) => r.status === 'completed');
  const avgRatingGiven = (() => {
    const rated = rides.filter((r) => r.customer_rating !== null);
    return rated.length ? (rated.reduce((s, r) => s + (r.customer_rating ?? 0), 0) / rated.length).toFixed(1) : '—';
  })();

  return (
    <>
      <PageHeader
        title={rollup.full_name ?? 'Unnamed customer'}
        subtitle={`${rollup.phone ?? 'no phone'} · signed up ${formatDateTime(rollup.signed_up_at ?? null)}`}
        actions={
          <Link to="/customers" className="text-sm font-medium text-indigo-600 hover:underline">
            ← All customers
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Rides requested" value={rollup.rides_requested ?? 0} />
        <StatCard label="Completed" value={rollup.rides_completed ?? 0} tone="good" />
        <StatCard label="Cancelled" value={rollup.rides_cancelled ?? 0} tone={(rollup.rides_cancelled ?? 0) > 3 ? 'bad' : 'default'} />
        <StatCard label="Total spend" value={formatFare(Number(rollup.total_spend ?? 0))} />
        <StatCard label="Free promo rides" value={rollup.free_rides_completed ?? 0} hint={`Issues raised: ${issues.length}`} />
      </div>

      <div className="space-y-6">
        <Card>
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Ride history ({rides.length}) · avg rating given: {avgRatingGiven}
            </h2>
          </div>
          <DataTable<Ride>
            data={rides}
            columns={[
              { header: 'Requested', accessorKey: 'requested_at', cell: (c) => formatDateTime(c.getValue<string>()) },
              { header: 'Route', accessorFn: (r) => `${r.pickup_address} → ${r.drop_address}`, enableSorting: false },
              { header: 'Type', accessorFn: (r) => titleize(r.ride_type) },
              { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge value={c.getValue<string>()} /> },
              { header: 'Distance', accessorFn: (r) => r.pricing_distance_meters, cell: (c) => formatKm(c.getValue<number | null>()) },
              {
                header: 'Fare',
                accessorFn: (r) => Number(r.final_fare ?? r.estimated_fare),
                cell: (c) => (
                  <div>
                    <div>{formatFare(c.getValue<number>())}</div>
                    {c.row.original.customer_charge_type === 'free' ? (
                      <div className="text-xs font-medium text-emerald-600">promo free</div>
                    ) : null}
                  </div>
                ),
              },
              { header: 'Payment', accessorKey: 'payment_status', cell: (c) => <StatusBadge value={c.getValue<string | null>()} /> },
              { header: 'Rating given', accessorFn: (r) => r.captain_rating ?? '—' },
              {
                header: 'Cancellation',
                accessorFn: (r) => r.cancellation_reason_code,
                cell: (c) =>
                  c.getValue<string>() ? (
                    <span className="text-xs text-slate-500">
                      {titleize(c.getValue<string>())}
                      {c.row.original.cancellation_reason_detail ? ` — ${c.row.original.cancellation_reason_detail}` : ''}
                    </span>
                  ) : (
                    '—'
                  ),
              },
            ]}
            emptyMessage="No rides yet."
          />
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Payment issues raised ({issues.length})</h2>
            </div>
            {issues.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No payment issues reported.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {issues.map((issue) => (
                  <li key={issue.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-800">{titleize(issue.reason)}</span>
                      <span className="text-xs text-slate-400">{formatDateTime(issue.opened_at)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      ride <code className="rounded bg-slate-100 px-1">{issue.ride_id.slice(0, 8)}</code> ·{' '}
                      <Link to="/payments?tab=issues" className="text-indigo-600 hover:underline">
                        open in payments
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Promotion usage ({entitlements.length})</h2>
            </div>
            {entitlements.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">No promotion entitlements.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {entitlements.map((e) => (
                  <li key={e.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <span className="font-medium text-slate-800">#{e.sequence}</span>{' '}
                      <span className="text-xs text-slate-500">{e.policy_code}</span>
                    </div>
                    <StatusBadge value={e.state} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {completedRides.length === 0 ? null : (
          <p className="text-xs text-slate-400">
            Showing the latest {rides.length} rides · {completedRides.length} of them completed.
          </p>
        )}
      </div>
    </>
  );
}
