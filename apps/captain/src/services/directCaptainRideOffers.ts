import Constants from 'expo-constants';
import { AppState, Linking, NativeModules, Platform } from 'react-native';
import { supabase } from '../lib/supabase';

const isExpoGo = Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';
const nativeAlert = NativeModules.CaptainOfferAlert as { start(rideId: string, offerId: string, expiresAt: number, pickup?: string, drop?: string, fare?: string): void; stop(offerId?: string): void; canDrawOverlays?: () => Promise<boolean>; openOverlaySettings?: () => void } | undefined;
let activeOfferId: string | null = null;

type OfferData = CaptainOfferNotification & { expiresAt: string; pickup?: string; drop?: string; fare?: string };
export type CaptainOfferNotification = { rideId: string; offerId: string; action?: 'accept' | 'reject' };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function captainOfferNotificationFromData(data: unknown): CaptainOfferNotification | null {
  if (!data || typeof data !== 'object') return null;
  const { type, rideId, offerId, action } = data as Record<string, unknown>;
  if (type !== 'ride_offer' || typeof rideId !== 'string' || typeof offerId !== 'string') return null;
  if (!uuidPattern.test(rideId) || !uuidPattern.test(offerId)) return null;
  return { rideId, offerId, ...(action === 'accept' || action === 'reject' ? { action } : {}) };
}

function parseOffer(data: unknown): OfferData | null {
  const offer = captainOfferNotificationFromData(data);
  if (!offer || !data || typeof data !== 'object') return null;
  const { expiresAt, pickup, drop, fare } = data as Record<string, unknown>;
  return typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt))
    ? { ...offer, expiresAt, ...(typeof pickup === 'string' ? { pickup } : {}), ...(typeof drop === 'string' ? { drop } : {}), ...(typeof fare === 'string' ? { fare } : {}) }
    : null;
}

export function startDirectCaptainOfferAlert(data: unknown) {
  const offer = parseOffer(data);
  if (!offer) return null;
  // The active app already owns the full in-app request sheet. Keep the
  // overlay exclusively for backgrounded/locked-device delivery.
  if (AppState.currentState === 'active' || Platform.OS !== 'android' || isExpoGo || !nativeAlert) return offer;
  activeOfferId = offer.offerId;
  nativeAlert.start(offer.rideId, offer.offerId, Date.parse(offer.expiresAt), offer.pickup, offer.drop, offer.fare);
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
    return captainOfferNotificationFromData({ type: 'ride_offer', rideId: parsed.searchParams.get('rideId'), offerId: parsed.searchParams.get('offerId'), action: parsed.searchParams.get('action') });
  } catch { return null; }
}

export async function isCaptainOfferOverlayAllowed() {
  if (Platform.OS !== 'android' || isExpoGo || !nativeAlert?.canDrawOverlays) return false;
  return nativeAlert.canDrawOverlays();
}

export function openCaptainOfferOverlaySettings() {
  if (Platform.OS === 'android' && !isExpoGo) nativeAlert?.openOverlaySettings?.();
}

// Overlay controls were added after the first Captain alert bridge. An OTA must
// never force a permission flow that its installed native binary cannot open.
export function canUseCaptainOfferOverlayControls() {
  return Platform.OS === 'android' && !isExpoGo && typeof nativeAlert?.canDrawOverlays === 'function' && typeof nativeAlert?.openOverlaySettings === 'function';
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
