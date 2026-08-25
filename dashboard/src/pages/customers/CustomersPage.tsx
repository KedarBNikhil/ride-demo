import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, ErrorBlock, LoadingBlock, PageHeader, SearchInput, StatCard } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { fetchCustomerRollups } from '@/lib/api';
import type { CustomerRollup } from '@/lib/types';
import { formatDate, formatFare, titleize } from '@/lib/format';

export function CustomersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const rollups = useQuery({ queryKey: ['customer-rollups'], queryFn: fetchCustomerRollups });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rollups.data ?? [];
    return (rollups.data ?? []).filter(
      (c) =>
        c.full_name?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.customer_id.toLowerCase().startsWith(q),
    );
  }, [rollups.data, search]);

  const totals = useMemo(
    () =>
      (rollups.data ?? []).reduce(
        (acc, c) => ({
          customers: acc.customers + 1,
          active30d:
            acc.active30d + (c.last_ride_at && Date.now() - new Date(c.last_ride_at).getTime() < 30 * 86_400_000 ? 1 : 0),
          issues: acc.issues + c.payment_issues_raised,
        }),
        { customers: 0, active30d: 0, issues: 0 },
      ),
    [rollups.data],
  );

  if (rollups.isLoading) return <LoadingBlock label="Loading customers…" />;
  if (rollups.error) return <ErrorBlock error={rollups.error} />;

  return (
    <>
      <PageHeader title="Customers" subtitle="Activity, spend and reported issues per customer account" />
      <div className="mb-4 grid grid-cols-3 gap-4">
        <StatCard label="Registered customers" value={totals.customers} />
        <StatCard label="Active last 30 days" value={totals.active30d} tone="good" />
        <StatCard label="Payment issues raised" value={totals.issues} tone={totals.issues ? 'warn' : 'default'} />
      </div>
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">{filtered.length} customers</h2>
          <SearchInput value={search} onChange={setSearch} placeholder="Search name or phone…" />
        </div>
        <DataTable<CustomerRollup>
          data={filtered}
          onRowClick={(row) => navigate(`/customers/${row.customer_id}`)}
          initialSorting={[{ id: 'last_ride_at', desc: true }]}
          columns={[
            {
              header: 'Customer',
              accessorKey: 'full_name',
              cell: (c) => (
                <div>
                  <div className="font-medium text-slate-800">{c.getValue<string>() ?? 'Unnamed'}</div>
                  <div className="text-xs text-slate-400">{c.row.original.phone ?? '—'}</div>
                </div>
              ),
            },
            { header: 'Rides', accessorKey: 'rides_requested' },
            { header: 'Completed', accessorKey: 'rides_completed' },
            { header: 'Cancelled', accessorKey: 'rides_cancelled', cell: (c) => (
              <span className={c.getValue<number>() > 2 ? 'font-semibold text-rose-600' : ''}>{c.getValue()}</span>
            ) },
            { header: 'Total spend', accessorFn: (r) => Number(r.total_spend), cell: (c) => formatFare(c.getValue<number>()) },
            { header: 'Free rides', accessorKey: 'free_rides_completed' },
            { header: 'Issues raised', accessorKey: 'payment_issues_raised', cell: (c) => (
              <span className={c.getValue<number>() > 0 ? 'font-semibold text-amber-600' : ''}>{c.getValue()}</span>
            ) },
            { header: 'Signed up', accessorFn: (r) => r.signed_up_at, cell: (c) => formatDate(c.getValue<string>()) },
            { header: 'Last ride', accessorFn: (r) => r.last_ride_at, cell: (c) => titleize(c.getValue<string>() ? formatDate(c.getValue<string>()) : 'never') },
          ] as ColumnDef<CustomerRollup, any>[]}
          emptyMessage="No customer accounts found."
        />
      </Card>
    </>
  );
}
