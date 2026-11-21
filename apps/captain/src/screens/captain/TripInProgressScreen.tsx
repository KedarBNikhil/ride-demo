import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LiveLocationMap, type LiveCoordinate } from '../../components/LiveLocationMap';
import { PrimaryButton } from '../../components/PrimaryButton';
import { rideDispatchService, type CaptainRideRequest } from '../../services/rideDispatch';
import { formatNumber } from '../../utils/format';
import { googleMapsService } from '../../services/googleMaps';
import { decodeGooglePolyline } from '../../utils/polyline';
import { openGoogleMapsNavigation } from '../../utils/googleNavigation';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';
import { hasMovedSignificantly } from '../../utils/location';
import { useBottomTabBarMetrics } from '../../utils/safeAreaLayout';
import { DraggableMapSheet } from '../../components/DraggableMapSheet';
import { IncomingRideRequestSheet } from './IncomingRideRequestSheet';
import { fitRouteInVisibleViewport, getVisibleMapPadding } from '../../utils/mapCamera';

const routeFallback: LiveCoordinate = { latitude: 15.4889, longitude: 78.4836 };

export function TripInProgressScreen({ request, onBack, onEndRide, onOpenChat }: { request: CaptainRideRequest; onBack: () => void; onEndRide: () => void; onOpenChat: () => void }) {
  const { t } = useTranslation();
  const { tabBarHeight } = useBottomTabBarMetrics();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<LiveCoordinate | null>(null);
  const lastPublishedLocation = useRef<LiveCoordinate | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [tripRoute, setTripRoute] = useState<LiveCoordinate[]>([]);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [tripState, setTripState] = useState({ startedAt: request.startedAt ?? null, travelledDistanceKm: request.travelledDistanceKm ?? null, status: 'in_progress' });
  const [now, setNow] = useState(Date.now);
  const [nextRideOffer, setNextRideOffer] = useState<CaptainRideRequest | null>(null);
  const [nextRideAccepted, setNextRideAccepted] = useState(false);
  const lastNextRideCheckAt = useRef(0);
  const hasNextRide = useRef(false);
  const hasFramedRoute = useRef(false);
  const routeStart = location ?? request.pickup ?? routeFallback;

  useEffect(() => rideDispatchService.subscribeToRide(request.rideId, (ride) => setTripState({ startedAt: ride.started_at ?? null, travelledDistanceKm: ride.travelled_distance_km == null ? null : Number(ride.travelled_distance_km), status: ride.status })), [request.rideId]);
  useEffect(() => {
    let active = true;
    const refreshUnreadCount = () => {
      void rideDispatchService.unreadRideMessageCount(request.rideId)
        .then((count) => { if (active) setUnreadMessageCount(count); })
        .catch(() => { if (active) setUnreadMessageCount(0); });
    };
    refreshUnreadCount();
    return rideDispatchService.subscribeToRideMessages(request.rideId, refreshUnreadCount);
  }, [request.rideId]);
  useEffect(() => {
    if (!tripState.startedAt || tripState.status !== 'in_progress') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [tripState.startedAt, tripState.status]);
  useEffect(() => {
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    const publish = (next: Location.LocationObject) => {
      const coordinate = { latitude: next.coords.latitude, longitude: next.coords.longitude };
      if (!hasMovedSignificantly(lastPublishedLocation.current, coordinate)) return;
      lastPublishedLocation.current = coordinate;
      setLocation(coordinate);
      void rideDispatchService.updateCaptainLocation(request.rideId, coordinate).then(() => {
        if (Date.now() - lastNextRideCheckAt.current < 45_000 || hasNextRide.current) return;
        lastNextRideCheckAt.current = Date.now();
        return rideDispatchService.checkNearCompletionOffer().catch(() => undefined);
      });
    };
    const start = async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') return;
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        publish(current);
        subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 10_000 }, (next) => { if (active) publish(next); });
      } catch { /* The lifecycle remains usable if a foreground fix is temporarily unavailable. */ }
    };
    void start();
    return () => { active = false; subscription?.remove(); };
  }, [request.rideId]);
  useEffect(() => rideDispatchService.subscribeToCaptainOffers((offer) => {
    if (offer) { hasNextRide.current = true; setNextRideOffer(offer); }
  }), []);
  useEffect(() => {
    let active = true;
    void googleMapsService.rideRoute(request.rideId, 'initial_trip')
      .then((route) => { if (active) setTripRoute(decodeGooglePolyline(route.encoded_polyline)); })
      .catch(() => { if (active) setTripRoute([]); });
    return () => { active = false; };
  }, [request.rideId]);
  useEffect(() => {
    if (!mapReady || hasFramedRoute.current || (!location && tripRoute.length < 2)) return;
    hasFramedRoute.current = fitRouteInVisibleViewport(mapRef.current, tripRoute.length > 1 ? tripRoute : [routeStart, request.drop], getVisibleMapPadding({ top: 72, bottomSheetHeight: 250, bottomInset: tabBarHeight }));
  }, [location, mapReady, request.drop, routeStart, tabBarHeight, tripRoute]);

  const elapsed = useMemo(() => {
    if (!tripState.startedAt) return '—';
    const seconds = Math.max(0, Math.floor((now - new Date(tripState.startedAt).getTime()) / 1000));
    return `${formatNumber(Math.floor(seconds / 60))}:${formatNumber(seconds % 60).padStart(2, '0')}`;
  }, [now, tripState.startedAt]);
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <LiveLocationMap mapRef={mapRef} location={location} onMapReady={() => setMapReady(true)}>
      <Marker coordinate={request.drop} pinColor={colors.accent} title={t('captain.destination')} description={request.destinationArea} />
      <Polyline coordinates={tripRoute.length > 1 ? tripRoute : [routeStart, request.drop]} strokeColor={colors.primary} strokeWidth={5} />
    </LiveLocationMap>
    <Pressable onPress={onBack} style={[styles.back, shadows.card]}><Text style={styles.backText}>‹</Text></Pressable>
    <DraggableMapSheet bottom={tabBarHeight} collapsedHeight={240} style={shadows.card}><Text style={styles.eyebrow}>{t('captain.tripInProgress')}</Text><Text style={styles.destination}>{request.destinationArea}</Text><View style={styles.stats}><Stat label={t('captain.elapsedTime')} value={elapsed} /><Stat label={t('captain.tripDistance')} value={tripState.travelledDistanceKm == null ? '—' : `${formatNumber(tripState.travelledDistanceKm, { maximumFractionDigits: 1 })} km`} /></View>{nextRideAccepted && <Text style={styles.nextRideAccepted}>Next ride accepted. Complete this ride first, then head to the next pickup.</Text>}<Pressable onPress={onOpenChat} accessibilityRole="button" style={styles.chatButton}><Text style={styles.chatButtonText}>💬 {t('captain.message')}</Text>{unreadMessageCount > 0 && <View style={styles.messageUnreadBadge}><Text style={styles.messageUnreadBadgeText}>{unreadMessageCount > 9 ? '9+' : unreadMessageCount}</Text></View>}</Pressable><PrimaryButton label={t('captain.navigate')} onPress={() => openGoogleMapsNavigation(request.drop)} secondary /><PrimaryButton label={t('captain.endRide')} onPress={onEndRide} /></DraggableMapSheet>
    {nextRideOffer && <IncomingRideRequestSheet request={nextRideOffer} bottomOffset={tabBarHeight} onReject={() => { const offer = nextRideOffer; hasNextRide.current = false; setNextRideOffer(null); if (offer) void rideDispatchService.respondToOffer(offer.offerId, false); }} onAccept={async () => { const offer = nextRideOffer; if (!offer) return; await rideDispatchService.respondToOffer(offer.offerId, true); hasNextRide.current = true; setNextRideOffer(null); setNextRideAccepted(true); }} />}
  </SafeAreaView>;
}
function Stat({ label, value }: { label: string; value: string }) { return <View style={styles.stat}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
const styles = StyleSheet.create({ safe: { backgroundColor: colors.bg, flex: 1 }, back: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 44, justifyContent: 'center', left: 16, position: 'absolute', top: 12, width: 44 }, backText: { color: colors.primary, fontSize: 32, lineHeight: 34 }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, gap: 8, left: 0, padding: 22, position: 'absolute', right: 0 }, eyebrow: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900', textTransform: 'uppercase' }, destination: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900' }, stats: { flexDirection: 'row', gap: 10, marginVertical: 4 }, stat: { backgroundColor: colors.bg, borderRadius: radii.md, flex: 1, gap: 3, padding: 12 }, statLabel: { color: colors.textMuted, fontFamily, fontSize: fontSize.xs }, statValue: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, nextRideAccepted: { backgroundColor: colors.successLight, borderRadius: radii.md, color: colors.success, fontFamily, fontSize: fontSize.sm, fontWeight: '800', padding: 10 }, chatButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.pill, borderWidth: 1, flexDirection: 'row', justifyContent: 'center', minHeight: 48, position: 'relative' }, chatButtonText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, messageUnreadBadge: { alignItems: 'center', backgroundColor: colors.error, borderColor: colors.surface, borderRadius: 9, borderWidth: 1, justifyContent: 'center', minWidth: 17, paddingHorizontal: 3, position: 'absolute', right: 14, top: 4 }, messageUnreadBadgeText: { color: colors.surface, fontFamily, fontSize: 10, fontWeight: '900', lineHeight: 15 } });
