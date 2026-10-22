// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2";

const amountPaise = 100;
const currency = 'INR';
const jsonHeaders = { 'Content-Type': 'application/json' };

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: jsonHeaders });
}

function text(value: unknown, maxLength = 256) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function basicAuthorization(keyId: string, keySecret: string) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
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

  const authorization = request.headers.get('Authorization');
  const token = authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return response({ error: 'Authentication required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const razorpayKeyId = Deno.env.get('RAZORPAY_TEST_KEY_ID');
  const razorpayKeySecret = Deno.env.get('RAZORPAY_TEST_KEY_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) return response({ error: 'Razorpay test checkout is not configured' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return response({ error: 'Authentication required' }, 401);

  const body = await request.json().catch(() => null) as { action?: unknown; razorpay_order_id?: unknown; razorpay_payment_id?: unknown; razorpay_signature?: unknown } | null;
  if (!body || (body.action !== 'create' && body.action !== 'verify')) return response({ error: 'Invalid request' }, 400);

  if (body.action === 'create') {
    const receipt = `sawaari-test-${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: basicAuthorization(razorpayKeyId, razorpayKeySecret), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise, currency, receipt, notes: { purpose: 'sawaari_android_test_checkout', customer_id: userData.user.id } }),
    });
    const razorpayBody = await razorpayResponse.json().catch(() => null) as { id?: unknown } | null;
    const orderId = text(razorpayBody?.id, 80);
    if (!razorpayResponse.ok || !orderId) return response({ error: 'Unable to create Razorpay test order' }, 502);

    const { error: insertError } = await admin.from('razorpay_test_payments').insert({ customer_id: userData.user.id, razorpay_order_id: orderId, amount_paise: amountPaise, currency, status: 'created' });
    if (insertError) return response({ error: 'Unable to record Razorpay test order' }, 500);
    return response({ keyId: razorpayKeyId, orderId, amountPaise, currency });
  }

  const orderId = text(body.razorpay_order_id, 80);
  const paymentId = text(body.razorpay_payment_id, 80);
  const signature = text(body.razorpay_signature, 128);
  if (!orderId || !paymentId || !signature) return response({ error: 'Payment verification details are required' }, 400);

  const { data: payment, error: paymentError } = await admin.from('razorpay_test_payments').select('id, status, razorpay_payment_id').eq('customer_id', userData.user.id).eq('razorpay_order_id', orderId).maybeSingle();
  if (paymentError || !payment) return response({ error: 'Test order not found' }, 404);
  if (payment.status === 'verified') return payment.razorpay_payment_id === paymentId ? response({ verified: true }) : response({ error: 'Test order was already verified' }, 409);

  const verified = await signatureMatches(orderId, paymentId, signature, razorpayKeySecret);
  const { error: updateError } = await admin.from('razorpay_test_payments').update({ razorpay_payment_id: paymentId, razorpay_signature: signature, status: verified ? 'verified' : 'verification_failed', verified_at: verified ? new Date().toISOString() : null }).eq('id', payment.id);
  if (updateError) return response({ error: 'Unable to record verification result' }, 500);
  return verified ? response({ verified: true }) : response({ error: 'Payment signature verification failed' }, 400);
});
