import { createClient } from 'npm:@supabase/supabase-js@2';

const currency = 'INR';
const jsonHeaders = { 'Content-Type': 'application/json' };

type Payment = { id?: unknown; order_id?: unknown; amount?: unknown; amount_refunded?: unknown; currency?: unknown; status?: unknown; method?: unknown };

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: jsonHeaders });
}

function text(value: unknown, maxLength = 256) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function basicAuthorization(keyId: string, keySecret: string) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

async function razorpayRequest(path: string, keyId: string, keySecret: string, init: RequestInit = {}) {
  return fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { Authorization: basicAuthorization(keyId, keySecret), 'Content-Type': 'application/json', ...init.headers },
  });
}

// Staging-only best-effort recovery while the native checkout is foregrounded.
// Supabase can stop background tasks, so the foreground reconciliation remains necessary.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };
function watchStagingOrder(admin: ReturnType<typeof createClient>, keyId: string, keySecret: string, rideId: string, customerId: string, orderId: string, amountPaise: number, currency: string) {
  EdgeRuntime.waitUntil((async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      try {
        const res = await razorpayRequest(`/orders/${encodeURIComponent(orderId)}/payments`, keyId, keySecret);
        if (!res.ok) continue;
        const body = await res.json() as { items?: Payment[] };
        const captures = (body.items ?? []).filter((p) => p.status === 'captured');
        if (captures.length !== 1) continue;
        const payment = captures[0];
        if (text(payment.order_id, 80) !== orderId || Number(payment.amount) !== amountPaise || text(payment.currency, 3) !== currency || Number(payment.amount_refunded ?? 0) !== 0) return;
        const { error } = await admin.rpc('reconcile_razorpay_captured_ride', { p_ride_id: rideId, p_customer_id: customerId, p_order_id: orderId, p_payment_id: text(payment.id, 80), p_amount_paise: amountPaise, p_currency: currency, p_provider_method: text(payment.method, 40) });
        if (error) console.error('[staging payment watcher] Reconciliation requires review');
        return;
      } catch { /* Retry until the short staging recovery window ends. */ }
    }
  })());
}

async function signatureMatches(orderId: string, paymentId: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${orderId}|${paymentId}`)));
  const supplied = Uint8Array.from(signature.match(/.{1,2}/g) ?? [], (value) => Number.parseInt(value, 16));
  if (expected.length !== supplied.length || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ supplied[index];
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response({ error: 'Authentication required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
  const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) return response({ error: 'Online payment is not configured' }, 503);
  // Staging is strictly limited to Razorpay test-mode keys, even if secrets are misconfigured.
  if (new URL(supabaseUrl).hostname === 'jhfjcujaspnkxznwytmb.supabase.co' && !razorpayKeyId.startsWith('rzp_test_')) return response({ error: 'Staging checkout requires Razorpay test credentials' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return response({ error: 'Authentication required' }, 401);
  const { error: pilotError } = await admin.rpc('assert_pilot_identity_for_user', { p_user_id: userData.user.id, p_app_variant: 'customer' });
  if (pilotError) return response({ error: 'Online payment is not available for this account' }, 403);

  const body = await request.json().catch(() => null) as { action?: unknown; rideId?: unknown; razorpay_order_id?: unknown; razorpay_payment_id?: unknown; razorpay_signature?: unknown } | null;
  const rideId = text(body?.rideId, 80);
  if (!body || !rideId || (body.action !== 'create' && body.action !== 'verify' && body.action !== 'reconcile')) return response({ error: 'Invalid request' }, 400);

  const { data: ride, error: rideError } = await admin.from('rides')
    .select('id, customer_id, status, customer_charge_type, customer_charge_amount, payment_status')
    .eq('id', rideId).eq('customer_id', userData.user.id).maybeSingle();
  if (rideError || !ride || ride.status !== 'completed' || ride.customer_charge_type !== 'standard') return response({ error: 'Online payment is not available for this ride' }, 409);

  if (body.action === 'reconcile') {
    const { data: recorded, error: lookupError } = await admin.from('razorpay_ride_payments')
      .select('razorpay_order_id,razorpay_payment_id,amount_paise,currency,status').eq('ride_id', rideId).eq('customer_id', userData.user.id).maybeSingle();
    if (lookupError) return response({ error: 'Unable to check payment status' }, 500);
    if (!recorded) return response({ state: 'not_started' });
    if (ride.payment_status === 'confirmed' && recorded.status === 'verified') return response({ state: 'confirmed' });
    const providerResponse = await razorpayRequest(`/orders/${encodeURIComponent(recorded.razorpay_order_id)}/payments`, razorpayKeyId, razorpayKeySecret);
    const provider = await providerResponse.json().catch(() => null) as { items?: Payment[] } | null;
    if (!providerResponse.ok || !Array.isArray(provider?.items)) return response({ error: 'Unable to check payment status' }, 502);
    const captures = provider.items.filter((p) => p.status === 'captured');
    if (!captures.length) return response({ state: 'pending' });
    if (captures.length !== 1) return response({ error: 'Payment needs manual review' }, 409);
    const payment = captures[0];
    if (text(payment.order_id, 80) !== recorded.razorpay_order_id || Number(payment.amount) !== recorded.amount_paise || text(payment.currency, 3) !== recorded.currency || Number(payment.amount_refunded ?? 0) !== 0) return response({ error: 'Payment needs manual review' }, 409);
    const { error } = await admin.rpc('reconcile_razorpay_captured_ride', { p_ride_id: rideId, p_customer_id: userData.user.id, p_order_id: recorded.razorpay_order_id, p_payment_id: text(payment.id, 80), p_amount_paise: recorded.amount_paise, p_currency: recorded.currency, p_provider_method: text(payment.method, 40) });
    if (error) return response({ error: 'Payment needs manual review' }, 409);
    return response({ state: 'confirmed' });
  }

  if (body.action === 'create') {
    if (ride.payment_status !== 'pending') return response({ error: 'This ride has already been settled' }, 409);
    const { data: existing, error: existingError } = await admin.from('razorpay_ride_payments')
      .select('razorpay_order_id, amount_paise, currency, status').eq('ride_id', rideId).maybeSingle();
    if (existingError) return response({ error: 'Unable to look up online payment' }, 500);
    if (existing && existing.status === 'created') {
      // Check the provider before reopening checkout: a lost SDK callback can
      // leave a captured payment behind an apparently pending local order.
      const providerResponse = await razorpayRequest(`/orders/${encodeURIComponent(existing.razorpay_order_id)}/payments`, razorpayKeyId, razorpayKeySecret);
      const provider = await providerResponse.json().catch(() => null) as { items?: Payment[] } | null;
      if (!providerResponse.ok || !Array.isArray(provider?.items)) return response({ error: 'Unable to check the previous payment. Please try again later.' }, 502);
      const captures = provider.items.filter((p) => p.status === 'captured');
      if (captures.length > 1) return response({ error: 'Payment needs manual review' }, 409);
      if (captures.length === 1) {
        const payment = captures[0];
        if (text(payment.order_id, 80) !== existing.razorpay_order_id || Number(payment.amount) !== existing.amount_paise || text(payment.currency, 3) !== existing.currency || Number(payment.amount_refunded ?? 0) !== 0) return response({ error: 'Payment needs manual review' }, 409);
        const { error } = await admin.rpc('reconcile_razorpay_captured_ride', { p_ride_id: rideId, p_customer_id: userData.user.id, p_order_id: existing.razorpay_order_id, p_payment_id: text(payment.id, 80), p_amount_paise: existing.amount_paise, p_currency: existing.currency, p_provider_method: text(payment.method, 40) });
        if (error) return response({ error: 'Payment needs manual review' }, 409);
        return response({ alreadyPaid: true });
      }
      if (provider.items.some((p) => p.status === 'created' || p.status === 'authorized')) return response({ error: 'A payment is still processing. Check its status before trying again.' }, 409);
      if (new URL(supabaseUrl).hostname === 'jhfjcujaspnkxznwytmb.supabase.co') watchStagingOrder(admin, razorpayKeyId, razorpayKeySecret, rideId, userData.user.id, existing.razorpay_order_id, existing.amount_paise, existing.currency);
      return response({ keyId: razorpayKeyId, orderId: existing.razorpay_order_id, amountPaise: existing.amount_paise, currency: existing.currency });
    }
    if (existing) return response({ error: 'This ride already has an online-payment attempt' }, 409);

    const amountPaise = Math.round(Number(ride.customer_charge_amount) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return response({ error: 'This ride has an invalid fare' }, 409);
    const receipt = `sawaari-ride-${rideId.replaceAll('-', '').slice(0, 24)}`;
    const razorpayResponse = await razorpayRequest('/orders', razorpayKeyId, razorpayKeySecret, {
      method: 'POST',
      body: JSON.stringify({ amount: amountPaise, currency, receipt, notes: { purpose: 'sawaari_ride_payment', ride_id: rideId, customer_id: userData.user.id } }),
    });
    const razorpayBody = await razorpayResponse.json().catch(() => null) as { id?: unknown } | null;
    const orderId = text(razorpayBody?.id, 80);
    if (!razorpayResponse.ok || !orderId) return response({ error: 'Unable to create Razorpay order' }, 502);
    const { error: insertError } = await admin.from('razorpay_ride_payments').insert({ ride_id: rideId, customer_id: userData.user.id, razorpay_order_id: orderId, amount_paise: amountPaise, currency, status: 'created' });
    if (insertError) return response({ error: 'Unable to record Razorpay order' }, 500);
    if (new URL(supabaseUrl).hostname === 'jhfjcujaspnkxznwytmb.supabase.co') watchStagingOrder(admin, razorpayKeyId, razorpayKeySecret, rideId, userData.user.id, orderId, amountPaise, currency);
    return response({ keyId: razorpayKeyId, orderId, amountPaise, currency });
  }

  const orderId = text(body.razorpay_order_id, 80);
  const paymentId = text(body.razorpay_payment_id, 80);
  const signature = text(body.razorpay_signature, 128);
  if (!orderId || !paymentId || !signature) return response({ error: 'Payment verification details are required' }, 400);

  const { data: paymentRecord, error: paymentError } = await admin.from('razorpay_ride_payments')
    .select('id, amount_paise, currency, status, razorpay_payment_id').eq('ride_id', rideId).eq('customer_id', userData.user.id).eq('razorpay_order_id', orderId).maybeSingle();
  if (paymentError || !paymentRecord) return response({ error: 'Online payment order not found' }, 404);
  if (paymentRecord.status === 'verified') {
    if (paymentRecord.razorpay_payment_id !== paymentId) return response({ error: 'This order was already verified' }, 409);
    if (ride.payment_status === 'confirmed') return response({ verified: true });
    const { data: recoveredRide, error: recoveryError } = await admin.from('rides')
      .update({ payment_status: 'confirmed', customer_charge_status: 'confirmed', payment_method: 'razorpay', paid_at: new Date().toISOString() })
      .eq('id', rideId).eq('customer_id', userData.user.id).eq('payment_status', 'pending').select('id').maybeSingle();
    if (recoveryError || !recoveredRide) return response({ error: 'Payment was captured but the ride could not be settled. Contact support with this payment ID.' }, 409);
    return response({ verified: true });
  }

  const signatureValid = await signatureMatches(orderId, paymentId, signature, razorpayKeySecret);
  if (!signatureValid) {
    await admin.from('razorpay_ride_payments').update({ razorpay_payment_id: paymentId, razorpay_signature: signature, status: 'verification_failed' }).eq('id', paymentRecord.id);
    return response({ error: 'Payment signature verification failed' }, 400);
  }

  let paymentResponse = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`, razorpayKeyId, razorpayKeySecret);
  let payment = await paymentResponse.json().catch(() => null) as Payment | null;
  if (!paymentResponse.ok || text(payment?.order_id, 80) !== orderId || Number(payment?.amount) !== paymentRecord.amount_paise || text(payment?.currency, 3) !== paymentRecord.currency) return response({ error: 'Payment details do not match this ride' }, 400);
  if (payment?.status === 'authorized') {
    paymentResponse = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, razorpayKeyId, razorpayKeySecret, { method: 'POST', body: JSON.stringify({ amount: paymentRecord.amount_paise, currency: paymentRecord.currency }) });
    payment = await paymentResponse.json().catch(() => null) as Payment | null;
  }
  if (!paymentResponse.ok || payment?.status !== 'captured') return response({ error: 'Payment is not captured yet' }, 409);

  const now = new Date().toISOString();
  const { error: recordError } = await admin.from('razorpay_ride_payments').update({ razorpay_payment_id: paymentId, razorpay_signature: signature, provider_method: text(payment.method, 40) || null, status: 'verified', verified_at: now }).eq('id', paymentRecord.id);
  if (recordError) return response({ error: 'Unable to record payment verification' }, 500);
  const { data: settledRide, error: settleError } = await admin.from('rides').update({ payment_status: 'confirmed', customer_charge_status: 'confirmed', payment_method: 'razorpay', paid_at: now }).eq('id', rideId).eq('customer_id', userData.user.id).eq('payment_status', 'pending').select('id').maybeSingle();
  if (settleError || !settledRide) return response({ error: 'Payment was captured but the ride could not be settled. Contact support with this payment ID.' }, 409);
  return response({ verified: true });
});
