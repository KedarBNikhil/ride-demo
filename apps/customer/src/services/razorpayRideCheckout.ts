import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getSupabaseClient } from '../lib/supabase';

type CreatedOrder = { keyId: string; orderId: string; amountPaise: number; currency: string };
type VerifiedPayment = { verified: true };
type RazorpayCheckoutModule = {
  open(options: {
    key: string;
    amount: string;
    currency: string;
    name: string;
    description: string;
    order_id: string;
    theme: { color: string };
  }): Promise<Record<string, unknown>>;
};

export const isRazorpayRideCheckoutEnabled = Constants.expoConfig?.extra?.razorpayRideCheckoutEnabled === true;

function getAndroidRazorpayCheckout(): RazorpayCheckoutModule {
  if (Platform.OS !== 'android') {
    throw new Error('Online payment is not available in the iOS development build');
  }
  // Keep this import Android-only: the current Razorpay native bridge is used
  // exclusively for Android test checkout and is intentionally not linked on iOS.
  return require('react-native-razorpay').default as RazorpayCheckoutModule;
}

function result<T>(response: { data: T | null; error: { message: string } | null }) {
  if (response.error || !response.data) throw new Error(response.error?.message || 'Online payment is unavailable');
  return response.data;
}

export async function startRazorpayRideCheckout(rideId: string) {
  if (!isRazorpayRideCheckoutEnabled) throw new Error('Online payment is not enabled for this release');
  const RazorpayCheckout = getAndroidRazorpayCheckout();
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
