import * as Location from 'expo-location';
import MapView from 'react-native-maps';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LiveLocationMap, type LiveCoordinate } from '../../components/LiveLocationMap';
import { rideDispatchService, type CaptainActiveRide, type CaptainRideRequest, type DispatchRide } from '../../services/rideDispatch';
import { registerPushNotifications } from '../../services/pushNotifications';
import { IncomingRideRequestSheet } from './IncomingRideRequestSheet';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';
import { captainEarningsService } from '../../services/captainEarnings';
import { formatFare } from '../../utils/format';
export function CaptainDashboardScreen({ online, onToggle, onSettings, onBookings, onEarnings, onRequest, request, onAccept, onReject, requestCycle, onResumeRide }: { online: boolean; onToggle: () => void; onSettings: () => void; onBookings?: () => void; onEarnings?: () => void; onRequest: (request: CaptainRideRequest | null) => void; request: CaptainRideRequest | null; onAccept: () => void; onReject: () => void; requestCycle: number; onResumeRide?: (ride: CaptainActiveRide) => void }) {
  const { t } = useTranslation(); const mapRef = useRef<MapView>(null); const [location, setLocation] = useState<LiveCoordinate | null>(null); const [locationUnavailable, setLocationUnavailable] = useState(false);
  const freshLocationRequest = useRef<Promise<Location.LocationObject> | null>(null); const [today, setToday] = useState({ earnings: 0, trips: 0 });
  const requestFreshLocation = () => {
    if (!freshLocationRequest.current) {
      freshLocationRequest.current = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .finally(() => { freshLocationRequest.current = null; });
    }
    return freshLocationRequest.current;
  };
  const centerOnLocation = async () => {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      Alert.alert(t('home.locationServicesTitle'), t('home.locationServicesMessage'), [
        { text: t('actions.cancel'), style: 'cancel' },
        { text: t('home.openSettings'), onPress: () => { void Linking.openSettings(); } },
      ]);
      return;
    }
    if (location) {
      mapRef.current?.animateToRegion({ ...location, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 350);
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') { setLocationUnavailable(true); return; }
    try {
      const current = await requestFreshLocation();
      const coordinate = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setLocation(coordinate);
      setLocationUnavailable(false);
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.018, longitudeDelta: 0.018 }, location ? 250 : 450);
    } catch {
      if (location) mapRef.current?.animateToRegion({ ...location, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 650);
      else setLocationUnavailable(true);
    }
  };
  useEffect(() => {
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    let hasPublishedLocation = false;
    const publishLocation = (next: Location.LocationObject) => {
      if (!active) return;
      const coordinate = { latitude: next.coords.latitude, longitude: next.coords.longitude };
      hasPublishedLocation = true;
      setLocationUnavailable(false);
      setLocation(coordinate);
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 500);
    };
    const start = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active || permission.status !== 'granted') {
        setLocationUnavailable(true);
        return;
      }
      try {
        // A recent device location makes the captain immediately eligible for
        // nearby matching. The fresh GPS fix and continuous watcher then refine it.
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 500 });
        if (lastKnown) publishLocation(lastKnown);
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
          publishLocation,
          () => { if (active && !hasPublishedLocation) setLocationUnavailable(true); },
        );
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        publishLocation(current);
      } catch {
        if (active && !hasPublishedLocation) setLocationUnavailable(true);
      }
    };
    void start();
    return () => { active = false; subscription?.remove(); };
  }, []);
  useEffect(() => { void registerPushNotifications('captain').catch(() => undefined); }, []);
  useEffect(() => { void captainEarningsService.getToday().then((overview) => setToday({ earnings: overview.totalEarnings, trips: overview.tripCount })).catch(() => undefined); }, []);
  useEffect(() => { void rideDispatchService.getCaptainActiveRide().then((ride) => { if (ride) onResumeRide?.(ride); }).catch(() => undefined); }, [onResumeRide]);
  useEffect(() => { if (!online || request) return; return rideDispatchService.subscribeToCaptainOffers(onRequest); }, [online, onRequest, request, requestCycle]);
  useEffect(() => {
    if (!online) return;
    const refreshAvailability = () => { void rideDispatchService.setCaptainAvailability(true, location); };
    refreshAvailability();
    const timer = setInterval(refreshAvailability, 15_000);
    return () => clearInterval(timer);
  }, [location, online]);
  const toggleAvailability = () => { void rideDispatchService.setCaptainAvailability(!online, location).then(onToggle); };
  const showBookings = () => onBookings?.();
  const showEarnings = () => onEarnings?.();
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <LiveLocationMap mapRef={mapRef} location={location} />
    <Pressable onPress={centerOnLocation} accessibilityRole="button" accessibilityLabel={t('home.recenter')} style={[styles.recenterButton, shadows.card]}><Text style={styles.recenterIcon}>⌖</Text></Pressable>
    <View style={styles.header}>
      <View style={[styles.badge, online ? styles.onlineBadge : styles.offlineBadge]}><Text style={styles.badgeText}>{online ? t('captain.onlineWaiting') : t('captain.offlineStatus')}</Text></View>
    </View>
    {locationUnavailable && <View style={[styles.locationNotice, shadows.card]}><Text style={styles.locationText}>{t('home.locationUnavailable')}</Text></View>}
    {request ? <IncomingRideRequestSheet request={request} onAccept={onAccept} onReject={onReject} bottomOffset={76} /> : <View style={[styles.sheet, shadows.card]}>
      <View style={styles.handle} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.sheetContent}>
        <Text style={styles.bottomTitle}>{t(online ? 'captain.online' : 'captain.offline')}</Text>
        <Text style={styles.bottomDetail}>{t(online ? 'captain.onlineWaiting' : 'captain.offlineDetail')}</Text>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: online }} onPress={toggleAvailability} style={[styles.toggle, online ? styles.toggleOnline : styles.toggleOffline]}><View style={[styles.knob, online && styles.knobOnline]} /><Text style={styles.toggleText}>{t(online ? 'captain.goOffline' : 'captain.goOnline')}</Text></Pressable>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{formatFare(today.earnings)}</Text><Text style={styles.summaryLabel}>{t('captain.todayEarnings')}</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryValue}>{today.trips}</Text><Text style={styles.summaryLabel}>{t('captain.todayTrips')}</Text></View>
        </View>
        <Text style={styles.sheetHint}>{t('captain.homeSheetHint')}</Text>
      </ScrollView>
    </View>}
    <View style={styles.tabBar}>
      <CaptainTab icon="⌂" label={t('captain.tabHome')} active />
      <CaptainTab icon="▤" label={t('captain.tabBookings')} onPress={showBookings} />
      <CaptainTab icon="₹" label={t('captain.tabEarnings')} onPress={showEarnings} />
      <CaptainTab icon="♙" label={t('captain.tabProfile')} onPress={onSettings} />
    </View>
  </SafeAreaView>;
}
export function CaptainBookingsScreen({ onHome, onSettings, onEarnings, onResumeRide }: { onHome: () => void; onSettings: () => void; onEarnings: () => void; onResumeRide: (ride: CaptainActiveRide) => void }) {
  const { t } = useTranslation(); const [ride, setRide] = useState<DispatchRide | null>(null);
  useEffect(() => { void rideDispatchService.getCaptainLatestRide().then(setRide).catch(() => setRide(null)); }, []);
  const active = ride?.status === 'accepted' || ride?.status === 'arrived' || ride?.status === 'in_progress';
  const resume = async () => { const current = await rideDispatchService.getCaptainActiveRide(); if (current) onResumeRide(current); };
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}><View style={styles.bookings}><Text style={styles.bookingsTitle}>{t('captain.bookingsTitle')}</Text>{ride ? <Pressable accessibilityRole="button" onPress={() => { if (active) void resume(); }} style={[styles.booking, shadows.card]}><Text style={styles.bookingStatus}>{t(`captain.status${ride.status}`)}</Text><Text style={styles.bookingRoute} numberOfLines={1}>{ride.pickup_address}</Text><Text style={styles.bookingArrow}>→</Text><Text style={styles.bookingRoute} numberOfLines={1}>{ride.drop_address}</Text>{active && <Text style={styles.bookingAction}>{t('captain.viewBooking')} ›</Text>}</Pressable> : <Text style={styles.bookingsEmpty}>{t('captain.bookingsEmpty')}</Text>}</View><View style={styles.tabBar}><CaptainTab icon="⌂" label={t('captain.tabHome')} onPress={onHome} /><CaptainTab icon="▤" label={t('captain.tabBookings')} active /><CaptainTab icon="₹" label={t('captain.tabEarnings')} onPress={onEarnings} /><CaptainTab icon="♙" label={t('captain.tabProfile')} onPress={onSettings} /></View></SafeAreaView>;
}
function CaptainTab({ icon, label, active, onPress }: { icon: string; label: string; active?: boolean; onPress?: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={styles.tab}><Text style={[styles.tabIcon, active && styles.tabIconActive]}>{icon}</Text><Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ safe: { backgroundColor: colors.bg, flex: 1 }, header: { padding: 16 }, badge: { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 10 }, onlineBadge: { backgroundColor: colors.success }, offlineBadge: { backgroundColor: '#6B7280' }, badgeText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, locationNotice: { alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, marginTop: 6, paddingHorizontal: 16, paddingVertical: 10 }, locationText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 76, left: 0, maxHeight: '55%', minHeight: 270, position: 'absolute', right: 0 }, handle: { alignSelf: 'center', backgroundColor: colors.border, borderRadius: 3, height: 5, marginTop: 10, width: 42 }, sheetContent: { gap: 10, padding: 20, paddingBottom: 28 }, bottomTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900' }, bottomDetail: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, toggle: { alignItems: 'center', borderRadius: radii.pill, flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 7, minHeight: 58, paddingHorizontal: 18 }, toggleOnline: { backgroundColor: colors.primary }, toggleOffline: { backgroundColor: '#6B7280' }, knob: { backgroundColor: '#FFFFFF', borderRadius: 11, height: 22, width: 22 }, knobOnline: { backgroundColor: colors.surfaceMint }, toggleText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, summaryRow: { flexDirection: 'row', gap: 10, marginTop: 4 }, summaryCard: { backgroundColor: colors.bg, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, padding: 13 }, summaryValue: { color: colors.primaryDark, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, summaryLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, marginTop: 3 }, sheetHint: { color: colors.textMuted, fontFamily, fontSize: fontSize.xs, lineHeight: 18, marginTop: 2 }, bookings: { gap: 16, padding: 20 }, bookingsTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize['2xl'], fontWeight: '900' }, bookingsEmpty: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md }, booking: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 7, padding: 18 }, bookingStatus: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900' }, bookingRoute: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, bookingArrow: { color: colors.textMuted, fontSize: 20 }, bookingAction: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '900', marginTop: 6 }, tabBar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', left: 0, minHeight: 76, paddingBottom: 11, paddingTop: 9, position: 'absolute', right: 0, zIndex: 3 }, tab: { alignItems: 'center', flex: 1, gap: 2, minWidth: 0 }, tabIcon: { color: colors.textMuted, fontSize: 23, lineHeight: 25 }, tabIconActive: { color: colors.primary }, tabLabel: { color: colors.textMuted, fontFamily, fontSize: 11 }, tabLabelActive: { color: colors.primaryDark, fontWeight: '800' }, recenterButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, height: 50, justifyContent: 'center', position: 'absolute', right: 18, top: 76, width: 50, zIndex: 2 }, recenterIcon: { color: colors.primary, fontSize: 29, fontWeight: '800', lineHeight: 32 } });
