import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authorization = request.headers.get('Authorization');
  if (request.method !== 'POST' || !url || new URL(url).hostname !== 'jhfjcujaspnkxznwytmb.supabase.co') return respond({ error: 'Not available' }, 404);
  if (!anonKey || !authorization) return respond({ error: 'Authentication required' }, 401);
  const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: user, error: userError } = await client.auth.getUser();
  if (userError || !user.user) return respond({ error: 'Authentication required' }, 401);
  const { data: isOperator, error: operatorError } = await client.rpc('is_settlement_operator');
  if (operatorError || isOperator !== true) return respond({ error: 'Operator access required' }, 403);
  const id = Deno.env.get('RAZORPAY_KEY_ID');
  const secret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!id || !secret) return respond({ ready: false, reason: 'missing_credentials' });
  if (!id.startsWith('rzp_test_')) return respond({ ready: false, reason: 'test_key_required' });
  try {
    const body = await request.json().catch(() => ({})) as { order_id?: unknown };
    const orderId = typeof body.order_id === 'string' && /^order_[a-zA-Z0-9]+$/.test(body.order_id) ? body.order_id : null;
    const endpoint = orderId ? `https://api.razorpay.com/v1/orders/${orderId}/payments` : 'https://api.razorpay.com/v1/payments?count=1';
    const result = await fetch(endpoint, { headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}` } });
    const payload = await result.json().catch(() => ({})) as { items?: Array<{ id?: string; status?: string; amount?: number; currency?: string; method?: string; error_reason?: string; error_description?: string }> };
    return respond({ ready: result.ok, mode: 'test', reason: result.ok ? null : 'provider_authentication_or_access_failed', provider_status: result.status, ...(orderId && result.ok ? { attempts: (payload.items ?? []).map(({ id, status, amount, currency, method, error_reason, error_description }) => ({ id, status, amount, currency, method, error_reason, error_description })) } : {}) });
  } catch { return respond({ ready: false, mode: 'test', reason: 'provider_unreachable' }); }
});
