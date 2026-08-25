import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Badge, Card, ErrorBlock, LoadingBlock, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { fetchCaptainRollups } from '@/lib/api';
import type { CaptainRollup } from '@/lib/types';
import { formatDate, formatDuration, formatFare, titleize } from '@/lib/format';

export function CaptainsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const rollups = useQuery({ queryKey: ['captain-rollups'], queryFn: fetchCaptainRollups });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rollups.data ?? [];
    return (rollups.data ?? []).filter(
      (c) =>
        c.full_name?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.captain_id.toLowerCase().startsWith(q),
    );
  }, [rollups.data, search]);

  const totals = useMemo(
    () =>
      (rollups.data ?? []).reduce(
        (acc, c) => ({
          captains: acc.captains + 1,
          online: acc.online + (c.is_online ? 1 : 0),
          earnings: acc.earnings + Number(c.lifetime_earnings),
        }),
        { captains: 0, online: 0, earnings: 0 },
      ),
    [rollups.data],
  );

  if (rollups.isLoading) return <LoadingBlock label="Loading captains…" />;
  if (rollups.error) return <ErrorBlock error={rollups.error} />;

  return (
    <>
      <PageHeader title="Captains" subtitle="Rides, acceptance, earnings and availability per captain" />
      <div className="mb-4 grid grid-cols-3 gap-4">
        <StatCard label="Captains" value={totals.captains} />
        <StatCard label="Online now" value={totals.online} tone="good" />
        <StatCard label="Lifetime earnings owed+paid" value={formatFare(totals.earnings)} />
      </div>
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">{filtered.length} captains</h2>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or phone…" />
        </div>
        <DataTable<CaptainRollup>
          data={filtered}
          onRowClick={(row) => navigate(`/captains/${row.captain_id}`)}
          initialSorting={[{ id: 'last_ride_at', desc: true }]}
          columns={[
            {
              header: 'Captain',
              accessorKey: 'full_name',
              cell: (c) => (
                <div>
                  <div className="flex items-center gap-2 font-medium text-slate-800">
                    {c.getValue<string>() ?? 'Unnamed'}
                    {c.row.original.is_online ? <Badge tone="green">online</Badge> : null}
                    {c.row.original.open_payment_issues > 0 ? (
                      <Badge tone="red">{c.row.original.open_payment_issues} issue(s)</Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-400">
                    {c.row.original.phone ?? '—'} · {titleize(c.row.original.vehicle_type)}
                  </div>
                </div>
              ),
            },
            { header: 'Rides', accessorKey: 'rides_assigned' },
            { header: 'Completed', accessorKey: 'rides_completed' },
            {
              header: 'Accept rate',
              accessorFn: (r) => (r.offers_received ? r.offers_accepted / r.offers_received : null),
              cell: (c) => {
                const v = c.getValue<number | null>();
                if (v === null || c.row.original.offers_received === 0)
                  return <span className="text-xs text-slate-400">{c.row.original.offers_received} offers</span>;
                const pct = Math.round(v * 100);
                return (
                  <span className={pct < 40 ? 'font-semibold text-amber-600' : ''}>
                    {pct}% ({c.row.original.offers_accepted}/{c.row.original.offers_received})
                  </span>
                );
              },
            },
            { header: 'Earnings', accessorFn: (r) => Number(r.lifetime_earnings), cell: (c) => formatFare(c.getValue<number>()) },
            { header: 'Online time', accessorFn: (r) => r.online_minutes, cell: (c) => formatDuration(c.getValue<number>()) },
            { header: 'Onboarding', accessorFn: (r) => r.onboarding_status, cell: (c) => c.getValue<string>() ? <Badge tone="slate">{titleize(c.getValue<string>())}</Badge> : '—' },
            { header: 'Last ride', accessorFn: (r) => r.last_ride_at, cell: (c) => formatDate(c.getValue<string>()) },
          ] as ColumnDef<CaptainRollup, any>[]}
          emptyMessage="No captains found."
        />
      </Card>
    </>
  );
}
