import { createClient } from 'npm:@supabase/supabase-js@2';
import { runLiveHealthChecks } from '../../../monitoring/health/live.mjs';

type Status = 'HEALTHY' | 'NEEDS_ATTENTION' | 'RISK' | 'NOT_OBSERVABLE' | 'PROBE_ERROR';
type Finding = { service: string; component: string; status: Status; metric: string; value: string; threshold: string; evidence: string; reason: string; recommendedAlert: unknown; cadence: string };

const windows = new Map([['15m', 900_000], ['1h', 3_600_000], ['6h', 21_600_000], ['24h', 86_400_000]]);
const statuses: Status[] = ['HEALTHY', 'NEEDS_ATTENTION', 'RISK', 'NOT_OBSERVABLE', 'PROBE_ERROR'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
let running: Promise<unknown> | null = null;

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: cors }); }
function overall(counts: Record<Status, number>): Status {
  if (counts.RISK) return 'RISK';
  if (counts.NEEDS_ATTENTION) return 'NEEDS_ATTENTION';
  if (counts.PROBE_ERROR || counts.NOT_OBSERVABLE) return 'NOT_OBSERVABLE';
  return 'HEALTHY';
}

async function run(window: string) {
  const started = Date.now(); const findings: Finding[] = [];
  const add = (service: string, component: string, status: Status, metric: string, value: unknown, threshold: string, evidence: string, reason: string, recommendedAlert: unknown = null, cadence = 'DAILY MORNING AUDIT') => {
    findings.push({ service, component, status, metric, value: String(value), threshold, evidence, reason, recommendedAlert, cadence });
  };
  await runLiveHealthChecks({ add, env: { SUPABASE_URL: Deno.env.get('SUPABASE_URL'), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') }, windowMs: windows.get(window)! });
  for (const [service, component, reason] of [
    ['Customer app', 'Crash and non-fatal error health', 'Crashlytics is wired in the app, but no aggregate Crashlytics metrics API is configured.'],
    ['Captain app', 'Crash and non-fatal error health', 'Crashlytics is wired in the app, but no aggregate Crashlytics metrics API is configured.'],
    ['Customer app', 'Remote OTA / latest release', 'No EAS Update read integration is configured for this monitor.'],
    ['Captain app', 'Remote OTA / latest release', 'No EAS Update read integration is configured for this monitor.'],
    ['Twilio', 'SMS delivery telemetry', 'No read-only provider metrics integration is configured; this check never sends SMS.'],
    ['Google Maps', 'Quota and provider errors', 'No Google Cloud Monitoring read integration is configured; probing Maps would create billable traffic.'],
    ['Push notifications', 'Device delivery health', 'Server-to-provider/device receipts are not currently available as aggregate telemetry.'],
    ['Storage', 'Bucket and upload health', 'No safe aggregate storage telemetry query is configured; private documents are never downloaded.'],
    ['KYC/documents', 'Captain eligibility versus document state', 'No aggregate operator monitoring query is configured.'],
    ['Account deletion / anti-abuse', 'Deletion integrity', 'No aggregate deletion audit event/query is configured.'],
  ]) add(service, component, 'NOT_OBSERVABLE', 'Provider telemetry', 'unavailable', 'Provider/API integration', 'Monitoring configuration', reason);
  const counts = Object.fromEntries(statuses.map((status) => [status, findings.filter((f) => f.status === status).length])) as Record<Status, number>;
  return { environment: 'production', observationWindow: window, startedAt: new Date(started).toISOString(), completedAt: new Date().toISOString(), durationMs: Date.now() - started, overall: overall(counts), counts, findings };
}

Deno.serve(async (request) => {
  // The browser preflights authenticated Supabase Function calls.  This is
  // intentionally unauthenticated: it grants no data or execution access.
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Authentication required' }, 401);
  const url = Deno.env.get('SUPABASE_URL')!; const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: 'Authentication required' }, 401);
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: authorized, error: authorizationError } = await caller.rpc('is_settlement_operator');
  if (authorizationError || authorized !== true) return json({ error: 'Operator authorization required' }, 403);
  const body = await request.json().catch(() => ({})) as { window?: unknown };
  const window = typeof body.window === 'string' && windows.has(body.window) ? body.window : '24h';
  if (running) return json({ error: 'Health audit already running' }, 409);
  running = run(window);
  try { return json({ data: await running }); }
  catch { return json({ error: 'Health audit could not complete.' }, 500); }
  finally { running = null; }
});
