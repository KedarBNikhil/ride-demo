import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, ErrorBlock, LoadingBlock, PageHeader, RangeSelect, StatCard } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { fetchFraudDataset } from '@/lib/api';
import type { FraudDataset } from '@/lib/api';
import { formatDate, formatDateTime, formatFare, titleize } from '@/lib/format';

export function FraudPage() {
  const [days, setDays] = useState(30);
  const data = useQuery({ queryKey: ['fraud-dataset', days], queryFn: () => fetchFraudDataset(days) });

  const analysis = useMemo(() => analyze(data.data, days), [data.data, days]);

  if (data.isLoading) return <LoadingBlock label="Scanning for fraud signals…" />;
  if (data.error) return <ErrorBlock error={data.error} />;

  return (
    <>
      <PageHeader
        title="Fraud Signals"
        subtitle={`Heuristic review of ${analysis.totalRides} rides from the last ${days} days`}
        actions={<RangeSelect days={days} onChange={setDays} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Flagged settlements" value={analysis.flaggedSettlements.length} tone={analysis.flaggedSettlements.length ? 'bad' : 'good'} />
        <StatCard label="Payment mismatches" value={analysis.methodMismatches.length} tone={analysis.methodMismatches.length ? 'warn' : 'good'} />
        <StatCard label="Stale declarations" value={analysis.staleDeclarations.length} tone={analysis.staleDeclarations.length ? 'warn' : 'good'} hint="Declared but unconfirmed >24h" />
        <StatCard label="Promo abuse suspects" value={analysis.promoAbusers.length} tone={analysis.promoAbusers.length ? 'warn' : 'good'} />
        <StatCard label="Other anomalies" value={analysis.cancellationSpikes.length + analysis.otpAnomalies.length} tone="default" />
      </div>

      <div className="space-y-6">
        <Section title="Flagged settlements" description="Operator-flagged payment declarations — review notes explain why.">
          <DataTable
            data={analysis.flaggedSettlements}
            columns={[
              { header: 'Declared at', accessorFn: (r) => r.declared_at, cell: (c) => formatDateTime(c.getValue<string>()) },
              { header: 'Ride', accessorKey: 'ride_id', cell: (c) => <code className="rounded bg-slate-100 px-1 text-xs">{String(c.getValue()).slice(0, 8)}</code> },
              { header: 'Amount', accessorFn: (r) => Number(r.amount_due), cell: (c) => formatFare(c.getValue<number>()) },
              { header: 'Method', accessorFn: (r) => titleize(r.declared_method) },
            ]}
            emptyMessage="Nothing flagged."
          />
        </Section>

        <Section title="Payment method mismatches" description="Customer-declared method differs from what was recorded on the ride.">
          <DataTable
            data={analysis.methodMismatches}
            columns={[
              { header: 'Ride', accessorKey: 'rideId', cell: (c) => <code className="rounded bg-slate-100 px-1 text-xs">{String(c.getValue()).slice(0, 8)}</code> },
              { header: 'Ride says', accessorFn: (r) => titleize(r.onRide) },
              { header: 'Settlement says', accessorFn: (r) => titleize(r.inSettlement) },
              { header: 'Amount', accessorFn: (r) => r.amount, cell: (c) => formatFare(c.getValue<number>()) },
              { header: 'Declared at', accessorFn: (r) => r.at, cell: (c) => formatDateTime(c.getValue<string>()) },
            ]}
            emptyMessage="No method conflicts."
          />
        </Section>

        <Section title="Stale declarations" description="Completed rides whose cash/UPI declaration has sat unconfirmed for more than 24 hours.">
          <DataTable
            data={analysis.staleDeclarations}
            columns={[
              { header: 'Requested', accessorFn: (r) => r.requestedAt, cell: (c) => formatDateTime(c.getValue<string>()) },
              { header: 'Ride', accessorKey: 'rideId', cell: (c) => <code className="rounded bg-slate-100 px-1 text-xs">{String(c.getValue()).slice(0, 8)}</code> },
              { header: 'Fare', accessorFn: (r) => r.fare, cell: (c) => formatFare(c.getValue<number>()) },
              { header: 'Method', accessorFn: (r) => titleize(r.method) },
            ]}
            emptyMessage="All declarations resolved promptly."
          />
        </Section>

        <Section
          title="Promotion abuse suspects"
          description={`Free-ride quota is ${analysis.maxFreeRides} under ${analysis.maxFreeDistanceMeters}m. Flags customers exhausting quota or repeatedly riding just under the distance cap.`}
        >
          <DataTable
            data={analysis.promoAbusers}
            columns={[
              { header: 'Customer', accessorKey: 'customerId', cell: (c) => <code className="rounded bg-slate-100 px-1 text-xs">{String(c.getValue()).slice(0, 8)}</code> },
              { header: 'Signal', accessorFn: (r) => r.signal },
              { header: 'Detail', accessorFn: (r) => r.detail },
              {
                header: '',
                id: 'link',
                enableSorting: false,
                cell: (c) =>
                  c.row.original.customerId ? (
                    <Link to={`/customers/${c.row.original.customerId}`} className="text-xs font-medium text-indigo-600 hover:underline">
                      inspect →
                    </Link>
                  ) : null,
              },
            ]}
            emptyMessage="Promo usage looks clean."
          />
        </Section>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Cancellation spikes</h2>
              <p className="text-xs text-slate-400">Customers with more than 3 cancellations in window</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {analysis.cancellationSpikes.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-slate-400">No spikes detected.</li>
              ) : (
                analysis.cancellationSpikes.map((s) => (
                  <li key={s.customerId} className="flex items-center justify-between px-4 py-3 text-sm">
                    <Link to={`/customers/${s.customerId}`} className="font-medium text-indigo-600 hover:underline">
                      {s.customerId.slice(0, 8)}
                    </Link>
                    <span>
                      <Badge tone="red">{s.count} cancellations</Badge>{' '}
                      <span className="ml-2 text-xs text-slate-500">top: {titleize(s.topReason)}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Pickup OTP anomalies</h2>
              <p className="text-xs text-slate-400">≥3 wrong OTP attempts on non-completed rides (counters clear on success)</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {analysis.otpAnomalies.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-slate-400">No OTP anomalies.</li>
              ) : (
                analysis.otpAnomalies.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <code className="rounded bg-slate-100 px-1 text-xs">{r.id.slice(0, 8)}</code>
                    <span>
                      <Badge tone="amber">{r.attempts} attempts</Badge>{' '}
                      <span className="ml-2 text-xs text-slate-500">{formatDate(r.requestedAt)}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </Card>
        </div>

        <Card className="p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Google API usage ({days}d)</h2>
          <p className="text-sm text-slate-600">
            Routes calls: <strong>{analysis.apiStats.total}</strong> · manual refreshes:{' '}
            <strong className={analysis.apiStats.refreshSpam ? 'text-amber-600' : ''}>{analysis.apiStats.manualRefreshes}</strong>{' '}
            {analysis.apiStats.refreshSpam ? '(possible refresh spam)' : ''} · failures:{' '}
            <strong className={analysis.apiStats.failures > 20 ? 'text-rose-600' : ''}>{analysis.apiStats.failures}</strong>
          </p>
          <p className="mt-2 text-xs text-slate-400">
            Daily hard cap is 100 calls; sustained manual-refresh volume can indicate client tampering or UX loops.
          </p>
        </Card>
      </div>
    </>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-slate-400">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}

function analyze(dataset: FraudDataset | undefined, _days: number) {
  const rides = dataset?.rides ?? [];
  const settlements = dataset?.settlements ?? [];
  const maxFreeRides = dataset?.maxFreeRides ?? 5;
  const maxFreeDistanceMeters = dataset?.maxFreeDistanceMeters ?? 2000;

  const flaggedSettlements = settlements.filter((s) => s.status === 'flagged');

  const rideById = new Map(rides.map((r) => [r.id, r]));
  const methodMismatches = settlements
    .filter((s) => {
      const ride = rideById.get(s.ride_id);
      return ride && ride.payment_method && s.declared_method !== ride.payment_method;
    })
    .map((s) => ({
      rideId: s.ride_id,
      onRide: rideById.get(s.ride_id)?.payment_method ?? '',
      inSettlement: s.declared_method,
      amount: Number(s.amount_due),
      at: s.declared_at,
    }));

  const staleDeclarations = rides
    .filter(
      (r) =>
        r.payment_status === 'declared' &&
        r.completed_at &&
        Date.now() - new Date(r.completed_at).getTime() > 24 * 3_600_000,
    )
    .map((r) => ({ rideId: r.id, requestedAt: r.requested_at, fare: Number(r.final_fare ?? 0), method: r.payment_method }));

  const freeCompleted = rides.filter((r) => r.status === 'completed' && r.customer_charge_type === 'free');
  const freeByCustomer = new Map<string, number>();
  for (const r of freeCompleted) freeByCustomer.set(r.customer_id, (freeByCustomer.get(r.customer_id) ?? 0) + 1);

  const nearCapByCustomer = new Map<string, number>();
  for (const r of freeCompleted) {
    if ((r.pricing_distance_meters ?? 0) >= maxFreeDistanceMeters * 0.75)
      nearCapByCustomer.set(r.customer_id, (nearCapByCustomer.get(r.customer_id) ?? 0) + 1);
  }

  const promoAbusers: Array<{ customerId: string; signal: string; detail: string }> = [];
  for (const [customerId, count] of freeByCustomer)
    if (count >= maxFreeRides)
      promoAbusers.push({
        customerId,
        signal: 'quota exhausted',
        detail: `${count} completed free rides (limit ${maxFreeRides})`,
      });
  for (const [customerId, count] of nearCapByCustomer)
    if (count >= 3)
      promoAbusers.push({
        customerId,
        signal: 'distance-edge riding',
        detail: `${count} free rides ≥75% of the ${maxFreeDistanceMeters / 1000}km free cap`,
      });

  const cancelByCustomer = new Map<string, { count: number; reasons: Map<string, number> }>();
  for (const r of rides.filter((x) => x.status === 'cancelled')) {
    const entry = cancelByCustomer.get(r.customer_id) ?? { count: 0, reasons: new Map() };
    entry.count += 1;
    const code = r.cancellation_reason_code ?? 'unknown';
    entry.reasons.set(code, (entry.reasons.get(code) ?? 0) + 1);
    cancelByCustomer.set(r.customer_id, entry);
  }
  const cancellationSpikes = [...cancelByCustomer.entries()]
    .filter(([, v]) => v.count > 3)
    .map(([customerId, v]) => ({
      customerId,
      count: v.count,
      topReason: [...v.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown',
    }));

  const otpAnomalies = rides
    .filter((r) => r.status !== 'completed' && (r.pickup_otp_attempt_count ?? 0) >= 3)
    .map((r) => ({ id: r.id, attempts: r.pickup_otp_attempt_count ?? 0, requestedAt: r.requested_at }));

  const manualRefreshes = (dataset?.routesLogs ?? []).filter((l) => l.route_kind === 'manual_refresh').length;
  const apiStats = {
    total: dataset?.routesLogs.length ?? 0,
    manualRefreshes,
    refreshSpam: manualRefreshes >= 50,
    failures: (dataset?.routesLogs ?? []).filter((l) => l.outcome === 'failed').length,
  };

  return {
    totalRides: rides.length,
    flaggedSettlements,
    methodMismatches,
    staleDeclarations,
    promoAbusers,
    cancellationSpikes,
    otpAnomalies,
    apiStats,
    maxFreeRides,
    maxFreeDistanceMeters,
  };
}
