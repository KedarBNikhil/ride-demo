import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';

// Expo Go does not provide this project's native push configuration. Avoid
// importing the native notifications module there so realtime testing works.
const isExpoGo = Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';

export type CaptainOfferNotification = { rideId: string; offerId: string };
export type CustomerRideNotification = { rideId: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Must be installed once for the entire app, rather than by a ride screen.
 * Expo Go deliberately skips the native module because this project has no
 * Expo Go push credentials.
 */
export function configurePushNotifications() {
  if (isExpoGo) return;
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export function captainOfferNotificationFromData(data: unknown): CaptainOfferNotification | null {
  if (!data || typeof data !== 'object') return null;
  const { type, rideId, offerId } = data as Record<string, unknown>;
  if (type !== 'ride_offer' || typeof rideId !== 'string' || typeof offerId !== 'string') return null;
  if (!uuidPattern.test(rideId) || !uuidPattern.test(offerId)) return null;
  return { rideId, offerId };
}

export function customerRideNotificationFromData(data: unknown): CustomerRideNotification | null {
  if (!data || typeof data !== 'object') return null;
  const { type, rideId } = data as Record<string, unknown>;
  if (typeof type !== 'string' || !['ride_accepted', 'ride_arrived', 'ride_in_progress', 'ride_completed', 'ride_cancelled'].includes(type)) return null;
  if (typeof rideId !== 'string' || !uuidPattern.test(rideId)) return null;
  return { rideId };
}

/**
 * Handles a tap both while the app is open and when the tap launched it.
 * The notification payload is only a route hint; the dispatch service still
 * verifies that this captain owns the exact offer and that it is pending.
 */
export function subscribeToCaptainOfferNotificationResponses(onOffer: (offer: CaptainOfferNotification) => void) {
  if (isExpoGo) return () => {};
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  const handled = new Set<string>();
  const handleResponse = (response: import('expo-notifications').NotificationResponse | null) => {
    const offer = captainOfferNotificationFromData(response?.notification.request.content.data);
    if (!offer) return;
    const key = `${offer.rideId}:${offer.offerId}`;
    if (handled.has(key)) return;
    handled.add(key);
    onOffer(offer);
  };

  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  const lastResponse = Notifications.getLastNotificationResponse();
  handleResponse(lastResponse);
  if (lastResponse && captainOfferNotificationFromData(lastResponse.notification.request.content.data)) {
    Notifications.clearLastNotificationResponse();
  }
  return () => subscription.remove();
}

/** The payload is only a route hint; the ride is reloaded under customer RLS. */
export function subscribeToCustomerRideNotificationResponses(onRide: (ride: CustomerRideNotification) => void) {
  if (isExpoGo) return () => {};
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  const handled = new Set<string>();
  const handleResponse = (response: import('expo-notifications').NotificationResponse | null) => {
    const ride = customerRideNotificationFromData(response?.notification.request.content.data);
    if (!ride || handled.has(ride.rideId)) return;
    handled.add(ride.rideId);
    onRide(ride);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  const lastResponse = Notifications.getLastNotificationResponse();
  handleResponse(lastResponse);
  if (lastResponse && customerRideNotificationFromData(lastResponse.notification.request.content.data)) Notifications.clearLastNotificationResponse();
  return () => subscription.remove();
}

export async function registerPushNotifications(appVariant: 'customer' | 'captain') {
  if (!supabase || isExpoGo) return null;
  const Device = require('expo-device') as typeof import('expo-device');
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  if (!Device.isDevice) return null;
  configurePushNotifications();
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === 'granted'
    ? existing
    : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;

  await Notifications.setNotificationChannelAsync('ride-updates', {
    name: 'Ride updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 180, 250],
    sound: 'default',
  });

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('EAS_PROJECT_ID_MISSING');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.rpc('register_push_device', {
    p_expo_push_token: token,
    p_platform: 'android',
    p_app_variant: appVariant,
  });
  if (error) throw error;
  return token;
}
