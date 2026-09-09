import Constants from 'expo-constants';
import { Linking, NativeModules, Platform } from 'react-native';
import { supabase } from '../lib/supabase';

const isExpoGo = Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';
const nativeAlert = NativeModules.CaptainOfferAlert as { start(rideId: string, offerId: string, expiresAt: number): void; stop(offerId?: string): void } | undefined;
let activeOfferId: string | null = null;

type OfferData = CaptainOfferNotification & { expiresAt: string };
export type CaptainOfferNotification = { rideId: string; offerId: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function captainOfferNotificationFromData(data: unknown): CaptainOfferNotification | null {
  if (!data || typeof data !== 'object') return null;
  const { type, rideId, offerId } = data as Record<string, unknown>;
  if (type !== 'ride_offer' || typeof rideId !== 'string' || typeof offerId !== 'string') return null;
  return uuidPattern.test(rideId) && uuidPattern.test(offerId) ? { rideId, offerId } : null;
}

function parseOffer(data: unknown): OfferData | null {
  const offer = captainOfferNotificationFromData(data);
  if (!offer || !data || typeof data !== 'object') return null;
  const expiresAt = (data as Record<string, unknown>).expiresAt;
  return typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)) ? { ...offer, expiresAt } : null;
}

export function startDirectCaptainOfferAlert(data: unknown) {
  const offer = parseOffer(data);
  if (!offer || Platform.OS !== 'android' || isExpoGo || !nativeAlert) return null;
  activeOfferId = offer.offerId;
  nativeAlert.start(offer.rideId, offer.offerId, Date.parse(offer.expiresAt));
  return offer;
}

export function stopDirectCaptainOfferAlert(offerId?: string) {
  if (offerId && activeOfferId && offerId !== activeOfferId) return;
  activeOfferId = null;
  if (Platform.OS === 'android' && !isExpoGo) nativeAlert?.stop(offerId);
}

export function isDirectCaptainOfferAlertActive(offerId: string) {
  return activeOfferId === offerId;
}

function offerFromUrl(url: string): CaptainOfferNotification | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'exp+nandyal-ride-captain:' || parsed.hostname !== 'ride-offer') return null;
    return captainOfferNotificationFromData({ type: 'ride_offer', rideId: parsed.searchParams.get('rideId'), offerId: parsed.searchParams.get('offerId') });
  } catch { return null; }
}

export function subscribeToDirectCaptainOfferResponses(onOffer: (offer: CaptainOfferNotification) => void) {
  const handleUrl = ({ url }: { url: string }) => { const offer = offerFromUrl(url); if (offer) onOffer(offer); };
  const linking = Linking.addEventListener('url', handleUrl);
  void Linking.getInitialURL().then((url) => { if (url) handleUrl({ url }); }).catch(() => undefined);
  if (Platform.OS !== 'android' || isExpoGo) return () => linking.remove();
  try {
    const Messaging = require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
    const messaging = Messaging.getMessaging();
    const unsubscribe = Messaging.onMessage(messaging, (message) => { if (message.data?.type === 'ride_offer_closed' && typeof message.data.offerId === 'string') { stopDirectCaptainOfferAlert(message.data.offerId); return; } const offer = startDirectCaptainOfferAlert(message.data); if (offer) onOffer(offer); });
    return () => { linking.remove(); unsubscribe(); };
  } catch { return () => linking.remove(); }
}

export async function registerCaptainFcmDevice() {
  if (!supabase || Platform.OS !== 'android' || isExpoGo) return null;
  const Messaging = require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
  const token = await Messaging.getToken(Messaging.getMessaging());
  const { error } = await supabase.rpc('register_captain_fcm_device', { p_fcm_token: token });
  if (error) throw error;
  return token;
}

export function configureCaptainFcmBackgroundHandling() {
  if (Platform.OS !== 'android' || isExpoGo) return;
  try {
    const Messaging = require('@react-native-firebase/messaging') as typeof import('@react-native-firebase/messaging');
    Messaging.setBackgroundMessageHandler(Messaging.getMessaging(), async (message) => {
      if (message.data?.type === 'ride_offer_closed' && typeof message.data.offerId === 'string') stopDirectCaptainOfferAlert(message.data.offerId);
      else startDirectCaptainOfferAlert(message.data);
    });
  } catch {
    // Expo Push stays available when the direct native bridge is unavailable.
  }
}
