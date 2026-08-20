import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = { 'Content-Type': 'application/json' };
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

type WebhookPayload = { table?: string; type?: string; record?: Record<string, unknown>; old_record?: Record<string, unknown> };

function notificationFor(payload: WebhookPayload) {
  const record = payload.record ?? {};
  if (payload.table === 'ride_offers' && typeof record.captain_id === 'string') {
    return { userId: record.captain_id, variant: 'captain', title: 'New ride request', body: 'A nearby ride is available.', data: { rideId: record.ride_id, offerId: record.id, type: 'ride_offer' } };
  }
  if (payload.table === 'rides' && typeof record.customer_id === 'string') {
    if (record.status === payload.old_record?.status) return null;
    const messages: Record<string, [string, string]> = {
      accepted: ['Captain assigned', 'Your captain has accepted the ride.'],
      arrived: ['Captain arrived', 'Your captain is at the pickup point.'],
      in_progress: ['Ride started', 'Your trip is now in progress.'],
      completed: ['Ride completed', 'Please confirm payment and rate your captain.'],
      cancelled: ['Ride cancelled', 'Your ride has been cancelled.'],
    };
    const message = typeof record.status === 'string' ? messages[record.status] : undefined;
    if (message) return { userId: record.customer_id, variant: 'customer', title: message[0], body: message[1], data: { rideId: record.id, type: `ride_${record.status}` } };
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (request.headers.get('x-dispatch-webhook-secret') !== Deno.env.get('DISPATCH_WEBHOOK_SECRET')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const payload = await request.json() as WebhookPayload;
  const notification = notificationFor(payload);
  if (!notification) return Response.json({ delivered: 0 }, corsHeaders);
  const { data: tokens, error } = await supabase.from('push_device_tokens')
    .select('expo_push_token').eq('user_id', notification.userId).eq('app_variant', notification.variant);
  if (error) return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  if (!tokens?.length) return Response.json({ delivered: 0 }, corsHeaders);
  const result = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(tokens.map(({ expo_push_token }) => ({ to: expo_push_token, sound: 'default', title: notification.title, body: notification.body, data: notification.data, channelId: 'ride-updates', priority: 'high' }))),
  });
  if (!result.ok) return Response.json({ error: 'Expo push delivery failed' }, { status: 502, headers: corsHeaders });
  return Response.json({ delivered: tokens.length }, corsHeaders);
});
