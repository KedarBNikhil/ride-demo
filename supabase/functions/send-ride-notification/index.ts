import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Content-Type': 'application/json' };
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

type WebhookPayload = { table?: string; type?: string; record?: Record<string, unknown>; old_record?: Record<string, unknown> };

type RideNotification = {
  userId: string;
  variant: 'customer' | 'captain';
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId?: string;
  collapseId?: string;
};

const incomingRideChannel = 'incoming-ride-requests-v2';
const incomingRideSound = 'incoming_ride_alert.mp3';
type FirebaseServiceAccount = { client_email: string; private_key: string; project_id: string };
let firebaseToken: { value: string; expiresAt: number } | null = null;

function notificationsFor(payload: WebhookPayload): RideNotification[] {
  const record = payload.record ?? {};
  const oldRecord = payload.old_record ?? {};
  if (payload.table === 'customer_payment_issue_messages' && payload.type === 'INSERT' && record.sender_type === 'support' && typeof record.issue_id === 'string') {
    return [{ userId: '', variant: 'customer', title: 'New support message', body: 'A Sawaari support representative replied to your ride issue.', data: { issueId: record.issue_id, type: 'customer_support_message' } }];
  }
  if (payload.table === 'ride_messages' && payload.type === 'INSERT' && typeof record.ride_id === 'string' && typeof record.sender_id === 'string') {
    return [{ userId: '', variant: 'customer', title: 'New message', body: 'You have a new message about your ride.', data: { rideId: record.ride_id, senderId: record.sender_id, senderRole: record.sender_role, type: 'ride_message' } }];
  }
  if (payload.table === 'ride_offers' && payload.type === 'INSERT' && record.status === 'offered' && typeof record.captain_id === 'string') {
    return [{ userId: record.captain_id, variant: 'captain', title: 'New ride request', body: 'A nearby ride is available.', data: { rideId: record.ride_id, offerId: record.id, expiresAt: record.expires_at, type: 'ride_offer' }, channelId: incomingRideChannel, collapseId: `ride-offer-${record.id}` }];
  }
  if (payload.table === 'ride_offers' && payload.type === 'UPDATE' && typeof record.captain_id === 'string' && typeof record.id === 'string' && oldRecord.status === 'offered' && record.status !== 'offered') {
    return [{ userId: record.captain_id, variant: 'captain', title: '', body: '', data: { offerId: record.id, type: 'ride_offer_closed' }, channelId: incomingRideChannel, collapseId: `ride-offer-${record.id}` }];
  }
  if (payload.table !== 'rides') return [];

  const notifications: RideNotification[] = [];
  if (typeof record.customer_id === 'string' && record.status !== oldRecord.status) {
    const messages: Record<string, [string, string]> = {
      accepted: ['Captain assigned', 'Your captain has accepted the ride.'],
      arrived: ['Captain arrived', 'Your captain is at the pickup point. Have your pickup PIN ready.'],
      in_progress: ['Ride started', 'Your trip is now in progress.'],
      completed: ['Ride completed', 'Please confirm payment and rate your captain.'],
      cancelled: ['Ride cancelled', 'Your ride has been cancelled.'],
    };
    const message = typeof record.status === 'string' ? messages[record.status] : undefined;
    if (message) notifications.push({ userId: record.customer_id, variant: 'customer', title: message[0], body: message[1], data: { rideId: record.id, type: `ride_${record.status}` } });
  }
  if (typeof record.captain_id === 'string' && record.status !== oldRecord.status && record.status === 'cancelled') {
    notifications.push({ userId: record.captain_id, variant: 'captain', title: 'Ride cancelled', body: 'The customer or dispatch system cancelled this ride.', data: { rideId: record.id, type: 'ride_cancelled' } });
  }
  if (typeof record.captain_id === 'string' && record.payment_status !== oldRecord.payment_status && record.payment_status === 'declared') {
    notifications.push({ userId: record.captain_id, variant: 'captain', title: 'Payment declared', body: 'The customer has declared payment for this ride.', data: { rideId: record.id, type: 'ride_payment_declared' } });
  }
  return notifications;
}

async function sendToTokens(notification: RideNotification, tokens: string[]) {
  const invalidTokens = new Set<string>();
  for (let start = 0; start < tokens.length; start += 100) {
    const chunk = tokens.slice(start, start + 100);
    const result = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk.map((to) => ({ to, sound: notification.channelId === incomingRideChannel ? incomingRideSound : 'default', title: notification.title, body: notification.body, data: notification.data, channelId: notification.channelId ?? 'ride-updates', collapseId: notification.collapseId, priority: 'high' }))),
    });
    if (!result.ok) throw new Error('Expo push delivery failed');
    const response = await result.json() as { data?: Array<{ status?: string; details?: { error?: string } }> };
    response.data?.forEach((ticket, index) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') invalidTokens.add(chunk[index]);
    });
  }
  if (invalidTokens.size) await supabase.from('push_device_tokens').delete().in('expo_push_token', [...invalidTokens]);
}

async function isStillActionableOffer(offerId: string) {
  const { data, error } = await supabase
    .from('ride_offers')
    .select('status, expires_at')
    .eq('id', offerId)
    .maybeSingle();
  if (error) throw error;
  return data?.status === 'offered'
    && typeof data.expires_at === 'string'
    && new Date(data.expires_at).getTime() > Date.now();
}

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function privateKeyBytes(pem: string) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function firebaseAccessToken() {
  if (firebaseToken && firebaseToken.expiresAt > Date.now() + 60_000) return firebaseToken.value;
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!raw) return null;
  let account: FirebaseServiceAccount;
  try { account = JSON.parse(raw) as FirebaseServiceAccount; } catch { return null; }
  if (!account.client_email || !account.private_key || !account.project_id) return null;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }))}`;
  const key = await crypto.subtle.importKey('pkcs8', privateKeyBytes(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}` }) });
  if (!response.ok) return null;
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  firebaseToken = { value: body.access_token, expiresAt: Date.now() + Math.max(60, body.expires_in ?? 3600) * 1000 };
  return firebaseToken.value;
}

/** The overlay is rendered natively while React is suspended, so pass only the
 * offer information a Captain is already authorised to view. */
async function withCaptainOfferPresentation(notification: RideNotification) {
  if (notification.data.type !== 'ride_offer' || typeof notification.data.rideId !== 'string') return notification;
  const { data, error } = await supabase
    .from('rides')
    .select('pickup_address, drop_address, estimated_fare')
    .eq('id', notification.data.rideId)
    .maybeSingle();
  if (error || !data) return notification;
  return {
    ...notification,
    data: {
      ...notification.data,
      pickup: String(data.pickup_address ?? '').slice(0, 120),
      drop: String(data.drop_address ?? '').slice(0, 120),
      fare: `₹${Number(data.estimated_fare ?? 0).toFixed(0)}`,
    },
  };
}

async function sendDirectCaptainOfferSignal(notification: RideNotification, tokens: string[]) {
  const accessToken = await firebaseAccessToken();
  if (!accessToken || !tokens.length) return false;
  const offerId = notification.data.offerId;
  const isOffer = notification.data.type === 'ride_offer';
  if (typeof offerId !== 'string' || (isOffer && !(await isStillActionableOffer(offerId)))) return false;
  const raw = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')!) as FirebaseServiceAccount;
  const expiresAt = typeof notification.data.expiresAt === 'string' ? notification.data.expiresAt : '';
  // FCM's HTTP v1 API accepts protobuf Durations only: seconds with an `s`
  // suffix (for example, "22s"). Millisecond strings such as "22000ms" are
  // rejected, which would otherwise silently send the legacy Expo fallback
  // instead of waking the native Captain alert service.
  const ttlSeconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  let sent = false;
  for (const token of tokens) {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${raw.project_id}/messages:send`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { token, data: isOffer ? { type: 'ride_offer', rideId: String(notification.data.rideId), offerId, expiresAt, ...(typeof notification.data.pickup === 'string' ? { pickup: notification.data.pickup } : {}), ...(typeof notification.data.drop === 'string' ? { drop: notification.data.drop } : {}), ...(typeof notification.data.fare === 'string' ? { fare: notification.data.fare } : {}) } : { type: 'ride_offer_closed', offerId }, android: { priority: 'high', ttl: `${isOffer ? ttlSeconds : 10}s` } } }) });
    if (response.ok) { sent = true; continue; }
    const error = await response.text();
    // INVALID_ARGUMENT can describe a malformed message payload, not just a
    // bad token. Only remove a device token when FCM explicitly says it is no
    // longer registered, and retain the error in logs for diagnosis.
    console.error('Direct Captain FCM delivery failed', { status: response.status, fcmError: error.slice(0, 1_000) });
    if (error.includes('UNREGISTERED')) await supabase.from('captain_fcm_device_tokens').delete().eq('fcm_token', token);
  }
  return sent;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (request.headers.get('x-dispatch-webhook-secret') !== Deno.env.get('DISPATCH_WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const payload = await request.json() as WebhookPayload;
  const notifications = notificationsFor(payload);
  let delivered = 0;
  for (const notification of notifications) {
    if (notification.data.type === 'customer_support_message' && typeof notification.data.issueId === 'string') {
      const { data: issue, error: issueError } = await supabase.from('customer_payment_issues').select('customer_id, ride_id').eq('id', notification.data.issueId).maybeSingle();
      if (issueError) return Response.json({ error: issueError.message }, { status: 500, headers: corsHeaders });
      if (!issue) continue;
      notification.userId = issue.customer_id;
      notification.data = { ...notification.data, rideId: issue.ride_id };
    }
    if (notification.data.type === 'ride_message' && typeof notification.data.rideId === 'string' && typeof notification.data.senderId === 'string') {
      const { data: ride, error: rideError } = await supabase
        .from('rides')
        .select('customer_id, captain_id')
        .eq('id', notification.data.rideId)
        .maybeSingle();
      if (rideError) return Response.json({ error: rideError.message }, { status: 500, headers: corsHeaders });
      if (!ride) continue;
      const senderRole = notification.data.senderRole;
      if (senderRole === 'customer' && typeof ride.captain_id === 'string') {
        notification.userId = ride.captain_id;
        notification.variant = 'captain';
      } else if (senderRole === 'captain' && typeof ride.customer_id === 'string') {
        notification.userId = ride.customer_id;
        notification.variant = 'customer';
      } else if (ride.customer_id === notification.data.senderId && typeof ride.captain_id === 'string') {
        notification.userId = ride.captain_id;
        notification.variant = 'captain';
      } else if (ride.captain_id === notification.data.senderId && typeof ride.customer_id === 'string') {
        notification.userId = ride.customer_id;
        notification.variant = 'customer';
      } else {
        continue;
      }
    }
    const { data: tokens, error } = await supabase.from('push_device_tokens')
      .select('expo_push_token').eq('user_id', notification.userId).eq('app_variant', notification.variant);
    if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
    const values = tokens?.map(({ expo_push_token }) => expo_push_token) ?? [];
    if (notification.channelId === incomingRideChannel) {
      const { data: fcmTokens, error: fcmError } = await supabase.from('captain_fcm_device_tokens').select('fcm_token').eq('user_id', notification.userId);
      if (fcmError) return Response.json({ error: fcmError.message }, { status: 500, headers: corsHeaders });
      const directNotification = await withCaptainOfferPresentation(notification);
      const directDelivered = await sendDirectCaptainOfferSignal(directNotification, fcmTokens?.map(({ fcm_token }) => fcm_token) ?? []);
      // Legacy builds and devices without a direct-FCM registration receive
      // exactly one actionable notification per offer. A remote delivery must
      // never become a server-side alert loop.
      if (!directDelivered && notification.data.type === 'ride_offer' && values.length && await isStillActionableOffer(String(notification.data.offerId))) {
        await sendToTokens(notification, values);
      }
    } else if (values.length) {
      await sendToTokens(notification, values);
    }
    delivered += values.length;
  }
  return Response.json({ delivered }, corsHeaders);
});
