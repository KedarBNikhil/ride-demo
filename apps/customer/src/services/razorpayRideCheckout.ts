import Constants from 'expo-constants';
import RazorpayCheckout from 'react-native-razorpay';
import { getSupabaseClient } from '../lib/supabase';

type CreatedOrder = { keyId: string; orderId: string; amountPaise: number; currency: string };
type VerifiedPayment = { verified: true };

export const isRazorpayRideCheckoutEnabled = Constants.expoConfig?.extra?.razorpayRideCheckoutEnabled === true;

function result<T>(response: { data: T | null; error: { message: string } | null }) {
  if (response.error || !response.data) throw new Error(response.error?.message || 'Online payment is unavailable');
  return response.data;
}

export async function startRazorpayRideCheckout(rideId: string) {
  if (!isRazorpayRideCheckoutEnabled) throw new Error('Online payment is not enabled for this release');
  const supabase = getSupabaseClient();
  const order = result(await supabase.functions.invoke<CreatedOrder>('razorpay-ride-checkout', { body: { action: 'create', rideId } }));
  const payment = await RazorpayCheckout.open({
    key: order.keyId,
    amount: String(order.amountPaise),
    currency: order.currency,
    name: 'Sawaari',
    description: 'Ride payment',
    order_id: order.orderId,
    theme: { color: '#0B6B5C' },
  });
  return result(await supabase.functions.invoke<VerifiedPayment>('razorpay-ride-checkout', { body: { action: 'verify', rideId, ...payment } }));
}
