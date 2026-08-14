import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LiveLocationMap, type LiveCoordinate } from '../../components/LiveLocationMap';
import { PrimaryButton } from '../../components/PrimaryButton';
import type { MockRideRequest } from '../../services/mockRideRequestService';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';
import { hasMovedSignificantly } from '../../utils/location';

const routeFallback: LiveCoordinate = { latitude: 15.4889, longitude: 78.4836 };

export function ToPickupScreen({ request, onArrived, onBack }: { request: MockRideRequest; onArrived: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<LiveCoordinate | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const routeStart = location ?? routeFallback;

  useEffect(() => {
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    const start = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') return;
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        setLocation({ latitude: current.coords.latitude, longitude: current.coords.longitude });
        subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 25 }, (next) => {
          const coordinate = { latitude: next.coords.latitude, longitude: next.coords.longitude };
          setLocation((previous) => hasMovedSignificantly(previous, coordinate) ? coordinate : previous);
        });
      } catch { /* keep the immediate fallback route visible */ }
    };
    void start();
    return () => { active = false; subscription?.remove(); };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.fitToCoordinates([routeStart, request.pickup], { animated: true, edgePadding: { top: 110, right: 70, bottom: 270, left: 70 } });
  }, [mapReady, request.pickup, routeStart.latitude, routeStart.longitude]);

  const callCustomer = () => { void Linking.openURL(`tel:${request.maskedCustomerNumber}`); };
  const messageCustomer = () => { void Linking.openURL(`sms:${request.maskedCustomerNumber}`); };

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <LiveLocationMap mapRef={mapRef} location={location} onMapReady={() => setMapReady(true)}>
      <Marker coordinate={request.pickup} pinColor={colors.accent} title={t('captain.pickup')} description={request.pickupArea} />
      <Polyline coordinates={[routeStart, request.pickup]} strokeColor={colors.primary} strokeWidth={5} />
    </LiveLocationMap>
    <Pressable onPress={onBack} style={[styles.back, shadows.card]}><Text style={styles.backText}>‹</Text></Pressable>
    <View style={[styles.sheet, shadows.card]}>
      <Text style={styles.eyebrow}>{t('captain.toPickup')}</Text><Text style={styles.name}>{request.customerName}</Text><Text style={styles.area}>{request.pickupArea}</Text>
      <View style={styles.contact}>
        <Pressable onPress={callCustomer} style={styles.contactButton}><Text style={styles.contactText}>☎ {t('captain.call')}</Text></Pressable>
        <Pressable onPress={messageCustomer} style={styles.contactButton}><Text style={styles.contactText}>✉ {t('captain.message')}</Text></Pressable>
      </View>
      <PrimaryButton label={t('captain.arrivedAtPickup')} onPress={onArrived} />
    </View>
  </SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { backgroundColor: colors.bg, flex: 1 }, back: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 44, justifyContent: 'center', left: 16, position: 'absolute', top: 12, width: 44 }, backText: { color: colors.primary, fontSize: 32, lineHeight: 34 }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 0, gap: 6, left: 0, padding: 22, position: 'absolute', right: 0 }, eyebrow: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900', textTransform: 'uppercase' }, name: { color: colors.textPrimary, fontFamily, fontSize: fontSize['2xl'], fontWeight: '900' }, area: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md }, contact: { flexDirection: 'row', gap: 10, marginVertical: 8 }, contactButton: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, flex: 1, minHeight: 44, justifyContent: 'center' }, contactText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' } });
