import Constants from 'expo-constants';
import RazorpayCheckout from 'react-native-razorpay';
import { getSupabaseClient } from '../lib/supabase';

type CreatedOrder = { keyId: string; orderId: string; amountPaise: number; currency: string };
type VerifiedPayment = { verified: true };

export const isRazorpayTestCheckoutEnabled = Constants.expoConfig?.extra?.razorpayTestCheckoutEnabled === true;

function result<T>(response: { data: T | null; error: { message: string } | null }) {
  if (response.error || !response.data) throw new Error(response.error?.message || 'Razorpay Test Mode is unavailable');
  return response.data;
}

export async function startRazorpayTestCheckout() {
  if (!isRazorpayTestCheckoutEnabled) throw new Error('Razorpay Test Mode is disabled');
  const supabase = getSupabaseClient();
  const order = result(await supabase.functions.invoke<CreatedOrder>('razorpay-test-checkout', { body: { action: 'create' } }));
  const payment = await RazorpayCheckout.open({
    key: order.keyId,
    amount: String(order.amountPaise),
    currency: order.currency,
    name: 'Sawaari',
    description: 'Test Mode checkout',
    order_id: order.orderId,
    theme: { color: '#0B6B5C' },
  });
  return result(await supabase.functions.invoke<VerifiedPayment>('razorpay-test-checkout', { body: { action: 'verify', ...payment } }));
}
