// Runtime-neutral, observational health checks shared by the Node CLI and the
// operator-only Edge Function. This module performs GET requests only.
export async function runLiveHealthChecks({ add, env, windowMs, fetchImpl = fetch }) {
  const base = (env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
  const readKey = env.SAWAARI_HEALTH_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const timedFetch = async (url, options = {}) => {
    const started = Date.now();
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(12_000) });
    return { response, latency: Date.now() - started };
  };
  const alert = (trigger, severity, reason, suggestedResponse, baseline = null) => ({ trigger, severity, reason, suggestedResponse, ...(baseline ? { baseline } : {}) });
  if (base) {
    try {
      const { response, latency } = await timedFetch(`${base}/auth/v1/health`, { method: 'GET' });
      add('Authentication', 'Supabase Auth availability', response.ok ? (latency < 1500 ? 'HEALTHY' : 'NEEDS_ATTENTION') : 'PROBE_ERROR', 'Auth health latency', response.ok ? `${latency} ms` : `HTTP ${response.status}`, '<1500 ms initial target', 'Supabase Auth API', response.ok ? 'Auth health endpoint responded.' : 'The monitoring probe was rejected or returned an unexpected response; this does not prove an Auth outage.', response.ok ? alert('Supabase Auth unavailable', 'RISK', 'Verified Customer and Captain login cannot proceed.', 'Check Supabase Auth status and recent Auth logs.') : null, 'INTRADAY PERIODIC');
    } catch (error) { add('Authentication', 'Supabase Auth availability', 'PROBE_ERROR', 'Auth health endpoint', 'unavailable', 'Successful bounded GET', 'Supabase Auth API', `The health probe could not establish a reliable network observation (${error instanceof Error ? error.message : 'unknown error'}); this is not proof that Auth is down.`, null, 'INTRADAY PERIODIC'); }
  }
  if (!base || !readKey) {
    for (const [service, component] of [['Supabase', 'Database/API read'], ['Ride platform', 'Ride creation and lifecycle'], ['Captain operations', 'Discovery, matching, GPS'], ['Financial controls', 'Fare, promo, payment, settlements'], ['KYC and storage', 'Documents'], ['Push notifications', 'Server submission']]) add(service, component, 'NOT_OBSERVABLE', 'Live production data', 'unavailable', 'Approved read-only production credential', 'Health runner credential configuration', 'No approved privileged read credential is available. The runner deliberately will not use mobile public credentials for protected data.', null, 'INTRADAY PERIODIC');
    return;
  }
  const readTable = async (table, query) => {
    const { response, latency } = await timedFetch(`${base}/rest/v1/${table}?${query}`, { method: 'GET', headers: { apikey: readKey, authorization: `Bearer ${readKey}`, accept: 'application/json', 'x-client-info': 'sawaari-read-only-health-audit' } });
    if (!response.ok) throw Object.assign(new Error(`${table} HTTP ${response.status}`), { status: response.status });
    return { rows: await response.json(), latency };
  };
  try {
    const { rows, latency } = await readTable('rides', 'select=*&order=requested_at.desc&limit=250');
    const dbStatus = latency < 500 ? 'HEALTHY' : latency <= 1500 ? 'NEEDS_ATTENTION' : 'RISK';
    add('Supabase', 'Database/API read', dbStatus, 'REST read latency', `${latency} ms`, '<500 ms healthy; 500–1500 ms attention; >1500 ms risk', 'Supabase Data API aggregate read', dbStatus === 'HEALTHY' ? 'The bounded read completed within the initial latency target.' : 'The bounded read completed outside the initial latency target.', alert('Supabase database/API latency high', dbStatus === 'RISK' ? 'RISK' : 'NEEDS_ATTENTION', 'Slow reads delay booking, dispatch, ride state, and payment screens.', 'Check Supabase status, database load, and recent logs; confirm sustained degradation.'), 'INTRADAY PERIODIC');
    const old = (time, ms) => !time || Date.now() - Date.parse(time) > ms;
    const inWindow = rows.filter((r) => Date.parse(r.requested_at || r.created_at || 0) >= Date.now() - windowMs);
    const initial = rows.filter((r) => ['requested', 'searching'].includes(r.status) && old(r.requested_at || r.created_at, 150_000));
    const accepted = rows.filter((r) => r.status === 'accepted' && old(r.accepted_at || r.updated_at, 20 * 60_000));
    const arrived = rows.filter((r) => r.status === 'arrived' && old(r.arrived_at || r.updated_at, 20 * 60_000));
    const byCustomer = new Map(); for (const r of rows.filter((r) => ['requested', 'searching', 'accepted', 'arrived', 'in_progress'].includes(r.status))) byCustomer.set(r.customer_id, (byCustomer.get(r.customer_id) || 0) + 1);
    const duplicateActive = [...byCustomer.values()].filter((n) => n > 1).length;
    const malformed = rows.filter((r) => !r.id || !r.status || !r.customer_id || !r.requested_at).length;
    const anomaly = initial.length || accepted.length || arrived.length || duplicateActive || malformed;
    add('Ride platform', 'Ride creation and state machine', anomaly ? 'RISK' : 'HEALTHY', 'Recent/stuck/contradictory rides', `${inWindow.length} created; ${initial.length} initial >150s; ${accepted.length} accepted >20m; ${arrived.length} arrived >20m; ${duplicateActive} duplicate-active; ${malformed} malformed`, 'Initial search auto-timeout is 2m; accepted/arrived threshold needs baseline', 'Supabase rides aggregate', anomaly ? 'One or more lifecycle anomalies require review; counts alone do not prove an outage.' : 'No scanned record violated the initial lifecycle rules.', alert('Stuck or contradictory ride state', 'RISK', 'A customer or Captain can be stranded; duplicates create billing and safety risk.', 'Review anonymized ride IDs and status history. Do not auto-cancel solely from the audit.', 'THRESHOLD_NEEDS_BASELINE for accepted/arrived.'), 'INTRADAY PERIODIC');
    const number = (row, names) => { for (const name of names) if (row[name] !== undefined && row[name] !== null && Number.isFinite(Number(row[name]))) return Number(row[name]); return null; };
    const negativeFare = rows.filter((r) => { const fare = number(r, ['customer_charge_amount', 'final_fare', 'estimated_fare']); return fare !== null && fare < 0; }).length;
    const completedUnpaid = rows.filter((r) => r.status === 'completed' && r.customer_charge_type !== 'free' && !['confirmed', 'not_required'].includes(r.payment_status)).length;
    const freePayment = rows.filter((r) => r.customer_charge_type === 'free' && r.payment_status !== 'not_required').length;
    add('Financial controls', 'Fare and payment integrity', negativeFare || completedUnpaid || freePayment ? 'RISK' : 'HEALTHY', 'Negative fare / completed unsettled / free-payment contradiction', `${negativeFare} / ${completedUnpaid} / ${freePayment}`, '0 expected; completed payment SLA needs baseline', 'Supabase rides aggregate', negativeFare || freePayment ? 'Authoritative pricing/payment fields contain a direct contradiction.' : completedUnpaid ? 'Completed standard rides require payment/settlement review.' : 'No scanned fare/payment contradiction found.', alert('Completed ride payment inconsistency', 'RISK', 'Unresolved payments harm trust, Captain collection, reconciliation, and fraud review.', 'Review anonymized ride records and the payment-issue workflow; do not alter payment state automatically.', 'THRESHOLD_NEEDS_BASELINE for completed-payment SLA.'), 'INTRADAY PERIODIC');
    const active = rows.filter((r) => r.status === 'in_progress'); let staleGps = 0;
    for (const r of active) { try { const sample = await readTable('ride_location_samples', `select=ride_id,device_recorded_at&ride_id=eq.${encodeURIComponent(r.id)}&order=device_recorded_at.desc&limit=1`); if (!sample.rows[0] || old(sample.rows[0].device_recorded_at, 120_000)) staleGps += 1; } catch { staleGps = null; break; } }
    add('Captain operations', 'Active ride GPS freshness', staleGps === null ? 'NOT_OBSERVABLE' : staleGps ? 'RISK' : 'HEALTHY', 'Active rides without GPS ≤120s', staleGps === null ? 'unavailable' : `${staleGps} of ${active.length}`, '≤90s healthy; 91–120s attention; >120s risk (45s cadence)', 'Captain location aggregate', staleGps === null ? 'Location samples were not readable with the monitoring credential.' : staleGps ? 'Active ride tracking is stale or absent for one or more active rides.' : 'Every scanned active ride has a recent sample, or there are no active rides.', alert('Captain GPS stale during active ride', 'RISK', 'Live location, safety sharing, and fraud-review evidence become unreliable.', 'Check Captain connectivity, location permission, and GPS ingestion. Do not cancel a ride solely from this monitor.'), 'REAL-TIME / HIGH PRIORITY');
  } catch (error) {
    const httpStatus = Number(error?.status);
    add('Supabase', 'Database/API read', httpStatus === 401 || httpStatus === 403 ? 'PROBE_ERROR' : 'RISK', 'Read-only connectivity', httpStatus ? `HTTP ${httpStatus}` : 'FAILED', 'Successful bounded read-only query', 'Supabase Data API', httpStatus === 401 || httpStatus === 403 ? 'The monitoring credential was rejected; this is a probe authorization issue, not proof that Supabase is unavailable.' : `The bounded read failed: ${error instanceof Error ? error.message : 'unknown error'}.`, null, 'INTRADAY PERIODIC');
  }
}
