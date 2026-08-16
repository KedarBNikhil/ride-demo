import * as Location from 'expo-location';
import MapView, { Marker, Polyline } from 'react-native-maps';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LiveLocationMap, type LiveCoordinate } from '../../components/LiveLocationMap';
import { PrimaryButton } from '../../components/PrimaryButton';
import { rideDispatchService, type CaptainRideRequest } from '../../services/rideDispatch';
import { formatNumber } from '../../utils/format';
import { hasMovedSignificantly } from '../../utils/location';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';

export type TripSummary = { durationSeconds: number; distanceKm: number };
const routeFallback: LiveCoordinate = { latitude: 15.4889, longitude: 78.4836 };

export function TripInProgressScreen({ request, onBack, onEndRide }: { request: CaptainRideRequest; onBack: () => void; onEndRide: (summary: TripSummary) => void }) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<LiveCoordinate | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const routeStart = location ?? routeFallback;
  const distance = seconds * 0.012;

  useEffect(() => { const timer = setInterval(() => setSeconds((value) => value + 1), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    const start = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') return;
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        const coordinate = { latitude: current.coords.latitude, longitude: current.coords.longitude };
        setLocation(coordinate); void rideDispatchService.updateCaptainLocation(request.rideId, coordinate);
        subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 25 }, (next) => {
          const coordinate = { latitude: next.coords.latitude, longitude: next.coords.longitude };
          setLocation((previous) => { if (!hasMovedSignificantly(previous, coordinate)) return previous; void rideDispatchService.updateCaptainLocation(request.rideId, coordinate); return coordinate; });
        });
      } catch { /* keep the immediate fallback route visible */ }
    };
    void start();
    return () => { active = false; subscription?.remove(); };
  }, []);
  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.fitToCoordinates([routeStart, request.drop], { animated: true, edgePadding: { top: 100, right: 70, bottom: 270, left: 70 } });
  }, [mapReady, request.drop, routeStart.latitude, routeStart.longitude]);

  const elapsed = `${formatNumber(Math.floor(seconds / 60))}:${formatNumber(seconds % 60).padStart(2, '0')}`;
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <LiveLocationMap mapRef={mapRef} location={location} onMapReady={() => setMapReady(true)}>
      <Marker coordinate={request.drop} pinColor={colors.accent} title={t('captain.destination')} description={request.destinationArea} />
      <Polyline coordinates={[routeStart, request.drop]} strokeColor={colors.primary} strokeWidth={5} />
    </LiveLocationMap>
    <Pressable onPress={onBack} style={[styles.back, shadows.card]}><Text style={styles.backText}>‹</Text></Pressable>
    <View style={[styles.sheet, shadows.card]}><Text style={styles.eyebrow}>{t('captain.tripInProgress')}</Text><Text style={styles.destination}>{request.destinationArea}</Text><View style={styles.stats}><Stat label={t('captain.elapsedTime')} value={elapsed} /><Stat label={t('captain.tripDistance')} value={`${formatNumber(distance, { maximumFractionDigits: 1 })} km`} /></View><PrimaryButton label={t('captain.endRide')} onPress={() => onEndRide({ durationSeconds: seconds, distanceKm: distance })} /></View>
  </SafeAreaView>;
}
function Stat({ label, value }: { label: string; value: string }) { return <View style={styles.stat}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
const styles = StyleSheet.create({ safe: { backgroundColor: colors.bg, flex: 1 }, back: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 44, justifyContent: 'center', left: 16, position: 'absolute', top: 12, width: 44 }, backText: { color: colors.primary, fontSize: 32, lineHeight: 34 }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 0, gap: 8, left: 0, padding: 22, position: 'absolute', right: 0 }, eyebrow: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900', textTransform: 'uppercase' }, destination: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900' }, stats: { flexDirection: 'row', gap: 10, marginVertical: 4 }, stat: { backgroundColor: colors.bg, borderRadius: radii.md, flex: 1, gap: 3, padding: 12 }, statLabel: { color: colors.textMuted, fontFamily, fontSize: fontSize.xs }, statValue: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' } });
