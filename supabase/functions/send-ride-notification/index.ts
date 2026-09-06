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
const incomingRideAlertIntervalMs = 2_000;
const incomingRideAlertMaxDeliveries = 6;

function notificationsFor(payload: WebhookPayload): RideNotification[] {
  const record = payload.record ?? {};
  if (payload.table === 'ride_offers' && payload.type === 'INSERT' && record.status === 'offered' && typeof record.captain_id === 'string') {
    return [{ userId: record.captain_id, variant: 'captain', title: 'New ride request', body: 'A nearby ride is available.', data: { rideId: record.ride_id, offerId: record.id, type: 'ride_offer' }, channelId: incomingRideChannel, collapseId: `ride-offer-${record.id}` }];
  }
  if (payload.table !== 'rides') return [];

  const oldRecord = payload.old_record ?? {};
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

/**
 * Remote pushes are handled by Android even when the Captain process is not
 * running. Re-delivering the same collapsed notification gives an incoming
 * offer a brief, bounded alert loop without a fragile background JS timer.
 */
async function sendIncomingRideAlertLoop(notification: RideNotification, tokens: string[]) {
  const offerId = notification.data.offerId;
  if (typeof offerId !== 'string') return;
  for (let delivery = 0; delivery < incomingRideAlertMaxDeliveries; delivery += 1) {
    if (!(await isStillActionableOffer(offerId))) return;
    await sendToTokens(notification, tokens);
    if (delivery + 1 < incomingRideAlertMaxDeliveries) {
      await new Promise<void>((resolve) => setTimeout(resolve, incomingRideAlertIntervalMs));
    }
  }
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
    const { data: tokens, error } = await supabase.from('push_device_tokens')
      .select('expo_push_token').eq('user_id', notification.userId).eq('app_variant', notification.variant);
    if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
    const values = tokens?.map(({ expo_push_token }) => expo_push_token) ?? [];
    if (values.length) {
      if (notification.channelId === incomingRideChannel) await sendIncomingRideAlertLoop(notification, values);
      else await sendToTokens(notification, values);
    }
    delivered += values.length;
  }
  return Response.json({ delivered }, corsHeaders);
});
