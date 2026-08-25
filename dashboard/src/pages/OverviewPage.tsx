import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Card, ErrorBlock, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { fetchCancellationBreakdown, fetchDailyStats, fetchLiveRides, fetchOnlineCaptains, fetchOverviewCounts } from '@/lib/api';
import type { LiveRideRow } from '@/lib/api';
import { formatCompact, formatFare, relativeTime, titleize } from '@/lib/format';

const WINDOW_DAYS = 30;
const REASON_COLORS = ['#6366f1', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#64748b'];

function withinWindow(day: string): boolean {
  return day >= new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

export function OverviewPage() {
  const stats = useQuery({ queryKey: ['daily-stats'], queryFn: fetchDailyStats });
  const cancellations = useQuery({ queryKey: ['cancellation-breakdown'], queryFn: fetchCancellationBreakdown });
  const counts = useQuery({ queryKey: ['overview-counts'], queryFn: fetchOverviewCounts });
  const live = useQuery({ queryKey: ['live-rides'], queryFn: fetchLiveRides, refetchInterval: 30_000 });
  const online = useQuery({ queryKey: ['online-captains'], queryFn: fetchOnlineCaptains, refetchInterval: 60_000 });

  const windowed = useMemo(() => (stats.data ?? []).filter((s) => withinWindow(s.day)), [stats.data]);
  const totals = useMemo(
    () =>
      windowed.reduce(
        (acc, s) => ({
          requested: acc.requested + s.requested_count,
          completed: acc.completed + s.completed_count,
          cancelled: acc.cancelled + s.cancelled_count,
          fare: acc.fare + Number(s.completed_fare_total),
          free: acc.free + s.free_rides,
        }),
        { requested: 0, completed: 0, cancelled: 0, fare: 0, free: 0 },
      ),
    [windowed],
  );
  const todayRow = windowed.at(-1);
  const completionRate = totals.requested ? Math.round((totals.completed / totals.requested) * 100) : null;

  const reasonTotals = useMemo(() => {
    const byReason = new Map<string, number>();
    for (const row of cancellations.data ?? []) {
      if (!withinWindow(row.day)) continue;
      byReason.set(row.reason_code ?? 'unknown', (byReason.get(row.reason_code ?? 'unknown') ?? 0) + row.cancellation_count);
    }
    return [...byReason.entries()].map(([name, value]) => ({ name: titleize(name), value }));
  }, [cancellations.data]);

  const actorTotals = useMemo(() => {
    const byActor = new Map<string, number>();
    for (const row of cancellations.data ?? []) {
      if (!withinWindow(row.day)) continue;
      byActor.set(row.actor_type, (byActor.get(row.actor_type) ?? 0) + row.cancellation_count);
    }
    return [...byActor.entries()];
  }, [cancellations.data]);

  if (stats.isLoading || cancellations.isLoading || counts.isLoading)
    return <LoadingBlock label="Loading overview…" />;
  if (stats.error) return <ErrorBlock error={stats.error} />;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Platform activity for the last ${WINDOW_DAYS} days`}
        actions={
          <Link
            to="/fraud"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Fraud signals
          </Link>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Rides today" value={todayRow?.requested_count ?? 0} hint={`${todayRow?.completed_count ?? 0} completed`} />
        <StatCard label="Completion rate" value={completionRate !== null ? `${completionRate}%` : '—'} hint={`${totals.completed} of ${totals.requested} rides`} />
        <StatCard label="Fare collected" value={formatFare(totals.fare)} hint={`${formatFare(totals.requested ? totals.fare / totals.completed : 0)} avg per completed`} />
        <StatCard label="Free promo rides" value={totals.free} hint="Completed under soft-launch promotion" />
        <StatCard
          label="Needs attention"
          value={(counts.data?.awaitingReview ?? 0) + (counts.data?.flagged ?? 0) + (counts.data?.openCaptainIssues ?? 0)}
          hint={
            counts.data
              ? `${counts.data.awaitingReview} settlements · ${counts.data.flagged} flagged · ${counts.data.openCaptainIssues} issues`
              : ''
          }
          tone={(counts.data?.awaitingReview ?? 0) + (counts.data?.openCaptainIssues ?? 0) > 0 ? 'warn' : 'good'}
        />
      </div>

      <div className="mb-6 grid gap-4 xl:grid-cols-3">
        <Card className="p-4 xl:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Daily ride volume</h2>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={windowed}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="requested_count" name="Requested" stroke="#6366f1" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="completed_count" name="Completed" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cancelled_count" name="Cancelled" stroke="#f43f5e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-700">Cancellations by reason</h2>
          <p className="mb-2 text-xs text-slate-400">
            By actor: {actorTotals.map(([actor, n]) => `${titleize(actor)} ${n}`).join(' · ') || '—'}
          </p>
          {reasonTotals.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">No cancellations in window.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={reasonTotals} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {reasonTotals.map((_, i) => (
                    <Cell key={i} fill={REASON_COLORS[i % REASON_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="mb-6">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Daily fare collected</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={windowed}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `₹${formatCompact(v)}`} />
              <Tooltip formatter={(v) => formatFare(Number(v))} />
              <Bar dataKey="completed_fare_total" name="Fare" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Live rides ({live.data?.length ?? 0})</h2>
            <span className="text-xs text-slate-400">auto-refreshes every 30s</span>
          </div>
          {live.isLoading ? (
            <LoadingBlock />
          ) : live.error ? (
            <ErrorBlock error={live.error} />
          ) : (
            <DataTable<LiveRideRow>
              columns={[
                { header: 'Customer', accessorFn: (r) => r.customer?.full_name ?? r.customer_id.slice(0, 8) },
                { header: 'Captain', accessorFn: (r) => r.captain_profile?.user_id.slice(0, 8) ?? 'Dispatching…' },
                { header: 'Type', accessorFn: (r) => titleize(r.ride_type) },
                { header: 'Route', accessorFn: (r) => `${r.pickup_address} → ${r.drop_address}`, enableSorting: false },
                { header: 'Status', accessorKey: 'status', cell: (c) => <StatusBadge value={c.getValue<string>()} /> },
                { header: 'Requested', accessorFn: (r) => relativeTime(r.requested_at) },
              ]}
              data={live.data ?? []}
              emptyMessage="No active rides right now."
            />
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Captains online now ({online.data?.length ?? 0})</h2>
          {online.isLoading ? (
            <LoadingBlock />
          ) : online.error ? (
            <ErrorBlock error={online.error} />
          ) : (online.data?.length ?? 0) === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">No captains currently online.</div>
          ) : (
            <ul className="space-y-2">
              {online.data!.map((c) => (
                <li key={c.captain_id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="green">{c.vehicle_type}</Badge>
                    <span className="text-sm font-medium text-slate-800">{c.full_name ?? c.phone}</span>
                  </div>
                  <Link to={`/captains/${c.captain_id}`} className="text-xs font-medium text-indigo-600 hover:underline">
                    view →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
