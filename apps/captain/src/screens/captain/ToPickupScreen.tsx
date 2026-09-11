import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LiveLocationMap, type LiveCoordinate } from '../../components/LiveLocationMap';
import { PrimaryButton } from '../../components/PrimaryButton';
import { rideDispatchService, type CaptainRideRequest } from '../../services/rideDispatch';
import { googleMapsService } from '../../services/googleMaps';
import { decodeGooglePolyline } from '../../utils/polyline';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';
import { openGoogleMapsNavigation } from '../../utils/googleNavigation';
import { hasMovedSignificantly } from '../../utils/location';
import { selectionHaptic } from '../../utils/haptics';
import { useBottomTabBarMetrics } from '../../utils/safeAreaLayout';
import { DraggableMapSheet } from '../../components/DraggableMapSheet';
import { fitRouteInVisibleViewport, getVisibleMapPadding } from '../../utils/mapCamera';

const routeFallback: LiveCoordinate = { latitude: 15.4889, longitude: 78.4836 };

export function ToPickupScreen({ request, arrived, onPrimaryAction, onBack, onOpenChat }: { request: CaptainRideRequest; arrived?: boolean; onPrimaryAction: () => void; onBack: () => void; onOpenChat: () => void }) {
  const { t } = useTranslation();
  const { tabBarHeight } = useBottomTabBarMetrics();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<LiveCoordinate | null>(null);
  const lastPublishedLocation = useRef<LiveCoordinate | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [storedRoute, setStoredRoute] = useState<LiveCoordinate[]>([]);
  const hasFramedRoute = useRef(false);
  const routeStart = location ?? routeFallback;

  useEffect(() => {
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    const publish = (next: Location.LocationObject) => {
      const coordinate = { latitude: next.coords.latitude, longitude: next.coords.longitude };
      if (!hasMovedSignificantly(lastPublishedLocation.current, coordinate)) return;
      lastPublishedLocation.current = coordinate;
      setLocation(coordinate);
      void rideDispatchService.updateCaptainLocation(request.rideId, coordinate);
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

  useEffect(() => {
    let active = true;
    void googleMapsService.rideRoute(request.rideId, 'captain_to_pickup')
      .then((route) => { if (active) setStoredRoute(decodeGooglePolyline(route.encoded_polyline)); })
      .catch(() => { if (active) setStoredRoute([]); });
    return () => { active = false; };
  }, [request.rideId]);

  useEffect(() => {
    if (!mapReady || hasFramedRoute.current || (!location && storedRoute.length < 2)) return;
    hasFramedRoute.current = fitRouteInVisibleViewport(mapRef.current, storedRoute.length > 1 ? storedRoute : [routeStart, request.pickup], getVisibleMapPadding({ top: 72, bottomSheetHeight: 260, bottomInset: tabBarHeight }));
  }, [location, mapReady, request.pickup, routeStart, storedRoute, tabBarHeight]);

  const canContactCustomer = Boolean(request.maskedCustomerNumber);
  const callCustomer = () => { if (canContactCustomer) void Linking.openURL(`tel:${request.maskedCustomerNumber}`); };
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <LiveLocationMap mapRef={mapRef} location={location} onMapReady={() => setMapReady(true)}>
      <Marker coordinate={request.pickup} pinColor={colors.accent} title={t('captain.pickup')} description={request.pickupArea} />
      <Polyline coordinates={storedRoute.length > 1 ? storedRoute : [routeStart, request.pickup]} strokeColor={colors.primary} strokeWidth={5} />
    </LiveLocationMap>
    <Pressable onPress={onBack} style={[styles.back, shadows.card]}><Text style={styles.backText}>‹</Text></Pressable>
    <DraggableMapSheet bottom={tabBarHeight} collapsedHeight={250} style={shadows.card}>
      <Text style={styles.eyebrow}>{t(arrived ? 'captain.startRideTitle' : 'captain.toPickup')}</Text><Text style={styles.name}>{request.customerName}</Text><Text style={styles.area}>{request.pickupArea}</Text>
      <View style={styles.contact}>
        <Pressable disabled={!canContactCustomer} onPress={() => { selectionHaptic(); callCustomer(); }} style={[styles.contactButton, !canContactCustomer && styles.contactDisabled]}><Text style={styles.contactText}>☎ {t('captain.call')}</Text></Pressable>
      </View>
      <Pressable onPress={() => { selectionHaptic(); onOpenChat(); }} accessibilityRole="button" style={styles.chatButton}><Text style={styles.chatButtonText}>💬 {t('captain.message')}</Text></Pressable>
      <PrimaryButton label={t('captain.navigate')} onPress={() => openGoogleMapsNavigation(request.pickup)} secondary />
      <PrimaryButton label={t(arrived ? 'captain.startRideTitle' : 'captain.arrivedAtPickup')} onPress={onPrimaryAction} />
    </DraggableMapSheet>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { backgroundColor: colors.bg, flex: 1 }, back: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 44, justifyContent: 'center', left: 16, position: 'absolute', top: 12, width: 44 }, backText: { color: colors.primary, fontSize: 32, lineHeight: 34 }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, gap: 6, left: 0, padding: 22, position: 'absolute', right: 0 }, eyebrow: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900', textTransform: 'uppercase' }, name: { color: colors.textPrimary, fontFamily, fontSize: fontSize['2xl'], fontWeight: '900' }, area: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md }, contact: { flexDirection: 'row', gap: 10, marginVertical: 8 }, contactButton: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, flex: 1, minHeight: 44, justifyContent: 'center' }, contactDisabled: { opacity: 0.45 }, contactText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, chatButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.pill, borderWidth: 1, justifyContent: 'center', minHeight: 42 }, chatButtonText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' } });
