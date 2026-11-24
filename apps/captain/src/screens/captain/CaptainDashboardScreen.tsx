import * as Location from 'expo-location';
import MapView from 'react-native-maps';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { LiveLocationMap, type LiveCoordinate } from '../../components/LiveLocationMap';
import { rideDispatchService, type CaptainActiveRide, type CaptainRideRequest, type DispatchRide } from '../../services/rideDispatch';
import { registerPushNotifications } from '../../services/pushNotifications';
import { IncomingRideRequestSheet } from './IncomingRideRequestSheet';
import { colors, fontFamily, fontFamilyBold, fontFamilyExtraBold, fontFamilySemiBold, fontSize, layout, radii, shadows } from '../../theme';
import { captainEarningsService } from '../../services/captainEarnings';
import { formatFare } from '../../utils/format';
import { filterAndSortRideHistory, rideHistoryPeriodLabel, type RideHistoryFilter } from '../../utils/rideHistory';
import { RideHistoryFilterControl } from '../../components/RideHistoryFilter';
import { selectionHaptic } from '../../utils/haptics';
import { useBottomTabBarMetrics } from '../../utils/safeAreaLayout';
import { HOME_LOCATION_DELTA } from '../../utils/mapCamera';
import { DraggableMapSheet } from '../../components/DraggableMapSheet';
import { BookOpen, CarFront, ChevronDown, Crosshair, Gift, House, IndianRupee, ReceiptText, Route, type LucideIcon, UserRound } from 'lucide-react-native';
const analyticsStyles = StyleSheet.create({ metricTile: { backgroundColor: colors.bg, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, minHeight: 92, padding: 11 }, accordion: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 }, accordionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 30 }, accordionTitle: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md, fontWeight: '900' }, analyticsRow: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 40 }, lastRow: { borderBottomWidth: 0 }, analyticsLabel: { color: colors.textSecondary, flex: 1, fontFamily, fontSize: fontSize.sm }, analyticsValue: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm, fontWeight: '900' } });
function AnalyticsRow({ Icon, label, value, last }: { Icon: LucideIcon; label: string; value: string; last?: boolean }) { return <View style={[analyticsStyles.analyticsRow, last && analyticsStyles.lastRow]}><Icon color={colors.primaryDark} size={19} /><Text style={analyticsStyles.analyticsLabel}>{label}</Text><Text style={analyticsStyles.analyticsValue}>{value}</Text></View>; }
export function CaptainDashboardScreen({ online, timeoutNotice, onToggle, onSettings, onBookings, onEarnings, onRequest, request, onAccept, onReject, requestCycle, onResumeRide }: { online: boolean; timeoutNotice?: string | null; onToggle: () => void; onSettings: () => void; onBookings?: () => void; onEarnings?: () => void; onRequest: (request: CaptainRideRequest | null) => void; request: CaptainRideRequest | null; onAccept: () => Promise<void>; onReject: () => void; requestCycle: number; onResumeRide?: (ride: CaptainActiveRide) => void }) {
  const { t } = useTranslation(); const { bottomInset, tabBarHeight } = useBottomTabBarMetrics(); const mapRef = useRef<MapView>(null); const [location, setLocation] = useState<LiveCoordinate | null>(null); const [locationUnavailable, setLocationUnavailable] = useState(false); const [availabilitySaving, setAvailabilitySaving] = useState(false); const [availabilityError, setAvailabilityError] = useState(false); const [today, setToday] = useState({ earnings: 0, trips: 0 }); const [todayAnalytics, setTodayAnalytics] = useState<Awaited<ReturnType<typeof captainEarningsService.getDailyAnalytics>>>(null); const [expandedMetric, setExpandedMetric] = useState<'earnings' | 'trips' | null>(null);
  const freshLocationRequest = useRef<Promise<Location.LocationObject> | null>(null);
  const requestFreshLocation = () => {
    if (!freshLocationRequest.current) freshLocationRequest.current = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).finally(() => { freshLocationRequest.current = null; });
    return freshLocationRequest.current;
  };
  const publishAvailability = (position: Location.LocationObject) => {
    const coordinate = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    setLocation(coordinate);
    setLocationUnavailable(false);
    void rideDispatchService.setCaptainAvailability(true, coordinate).catch(() => setAvailabilityError(true));
    return coordinate;
  };
  useEffect(() => {
    if (!online) return;
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    const start = async () => {
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        const permission = existing.status === 'granted' ? existing : await Location.requestForegroundPermissionsAsync();
        if (!active || permission.status !== 'granted') throw new Error('LOCATION_PERMISSION_DENIED');
        const cached = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 500 });
        if (cached) publishAvailability(cached);
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 10_000 },
          (next) => { if (active) publishAvailability(next); },
          () => { if (active && !location) setLocationUnavailable(true); },
        );
        void requestFreshLocation().then((next) => { if (active) publishAvailability(next); }).catch(() => { if (active && !cached) setLocationUnavailable(true); });
      } catch { if (active) setLocationUnavailable(true); }
    };
    void start();
    return () => { active = false; subscription?.remove(); };
  }, [online]);
  useEffect(() => { void registerPushNotifications('captain').catch(() => undefined); }, []);
  const initialCameraSet = useRef(false);
  useEffect(() => {
    if (!location || initialCameraSet.current) return;
    initialCameraSet.current = true;
    mapRef.current?.animateToRegion({ ...location, latitudeDelta: HOME_LOCATION_DELTA, longitudeDelta: HOME_LOCATION_DELTA }, 350);
  }, [location]);
  const refreshToday = useCallback(() => { void Promise.all([captainEarningsService.getToday(), captainEarningsService.getDailyAnalytics()]).then(([overview, analytics]) => { setToday({ earnings: overview.totalEarnings, trips: overview.tripCount }); setTodayAnalytics(analytics); }).catch(() => undefined); }, []);
  useFocusEffect(refreshToday);
  useEffect(() => rideDispatchService.subscribeToCaptainRides(refreshToday), [refreshToday]);
  useEffect(() => { void rideDispatchService.getCaptainActiveRide().then((ride) => { if (ride) onResumeRide?.(ride); }).catch(() => undefined); }, [onResumeRide]);
  useEffect(() => { if (!online) return; return rideDispatchService.subscribeToCaptainOffers(onRequest); }, [online, onRequest, requestCycle]);
  useEffect(() => {
    if (!online) return;
    const refreshAvailability = () => { if (location) void rideDispatchService.setCaptainAvailability(true, location).catch(() => setAvailabilityError(true)); };
    const timer = setInterval(refreshAvailability, 60_000);
    return () => clearInterval(timer);
  }, [location, online]);
  const toggleAvailability = async () => {
    if (availabilitySaving) return;
    setAvailabilitySaving(true);
    setAvailabilityError(false);
    try {
      if (online) {
        await rideDispatchService.setCaptainAvailability(false);
      } else {
        const existing = await Location.getForegroundPermissionsAsync();
        const permission = existing.status === 'granted' ? existing : await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') throw new Error('LOCATION_PERMISSION_DENIED');
        const cached = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 500 });
        const initial = cached ?? await requestFreshLocation();
        const coordinate = { latitude: initial.coords.latitude, longitude: initial.coords.longitude };
        setLocation(coordinate);
        await rideDispatchService.setCaptainAvailability(true, coordinate);
      }
      onToggle();
    } catch {
      setAvailabilityError(true);
    } finally {
      setAvailabilitySaving(false);
    }
  };
  const showBookings = () => onBookings?.();
  const showEarnings = () => onEarnings?.();
  const recenterOnLocation = () => { if (location) mapRef.current?.animateToRegion({ ...location, latitudeDelta: HOME_LOCATION_DELTA, longitudeDelta: HOME_LOCATION_DELTA }, 350); };
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <LiveLocationMap mapRef={mapRef} location={location} />
    <View style={styles.header}>
      <View style={[styles.badge, online ? styles.onlineBadge : styles.offlineBadge]}><Text style={styles.badgeText}>{online ? t('captain.onlineWaiting') : t('captain.offlineStatus')}</Text></View>
    </View>
    {!!timeoutNotice && <View style={[styles.locationNotice, shadows.card]}><Text style={styles.locationText}>{timeoutNotice}</Text></View>}
    <Pressable accessibilityRole="button" accessibilityLabel={t('home.recenter')} disabled={!location} onPress={() => { selectionHaptic(); recenterOnLocation(); }} style={[styles.recenterButton, shadows.card, !location && { opacity: 0.5 }]}><Crosshair color={colors.primary} size={25} /></Pressable>
    {locationUnavailable && <View style={[styles.locationNotice, shadows.card]}><Text style={styles.locationText}>{t('home.locationUnavailable')}</Text></View>}
    {request ? <IncomingRideRequestSheet request={request} onAccept={onAccept} onReject={onReject} bottomOffset={tabBarHeight} /> : <DraggableMapSheet bottom={tabBarHeight} collapsedHeight={238} style={shadows.card} contentContainerStyle={[styles.sheetContent, { paddingBottom: 20 + bottomInset }]}>
        <Text style={styles.bottomTitle}>{t(online ? 'captain.online' : 'captain.offline')}</Text>
        <Text style={styles.bottomDetail}>{t(online ? 'captain.onlineWaiting' : 'captain.offlineDetail')}</Text>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: online, disabled: availabilitySaving }} disabled={availabilitySaving} onPress={() => { selectionHaptic(); void toggleAvailability(); }} style={[styles.toggle, online ? styles.toggleOnline : styles.toggleOffline, availabilitySaving && styles.toggleDisabled]}><View style={[styles.knob, online && styles.knobOnline]} /><Text style={styles.toggleText}>{t(availabilitySaving ? 'captain.updatingAvailability' : online ? 'captain.goOffline' : 'captain.goOnline')}</Text></Pressable>
        {availabilityError && <Text accessibilityRole="alert" style={styles.availabilityError}>{t('captain.availabilityUpdateFailed')}</Text>}
        <View style={styles.summaryRow}>
          <Pressable onPress={() => setExpandedMetric(expandedMetric === 'earnings' ? null : 'earnings')} style={analyticsStyles.metricTile}><Text style={styles.summaryValue}>{formatFare(today.earnings)}</Text><Text style={styles.summaryLabel}>{t('captain.todayEarnings')}</Text></Pressable>
          <Pressable onPress={() => setExpandedMetric(expandedMetric === 'trips' ? null : 'trips')} style={analyticsStyles.metricTile}><Text style={styles.summaryValue}>{today.trips}</Text><Text style={styles.summaryLabel}>{t('captain.todayTrips')}</Text></Pressable>
        </View>
        {expandedMetric === 'earnings' && <Pressable onPress={() => setExpandedMetric(null)} style={analyticsStyles.accordion}><View style={analyticsStyles.accordionHeader}><Text style={analyticsStyles.accordionTitle}>{t('captain.todayEarnings')}</Text><ChevronDown color={colors.textPrimary} size={22} /></View><AnalyticsRow Icon={CarFront} label={t('captain.tripEarnings')} value={formatFare(todayAnalytics?.total_earnings ?? today.earnings)} /><AnalyticsRow Icon={Gift} label={t('captain.tipsBonus')} value="—" /><AnalyticsRow Icon={IndianRupee} label={t('captain.totalToday')} value={formatFare(todayAnalytics?.total_earnings ?? today.earnings)} /><AnalyticsRow Icon={ReceiptText} label={t('captain.lastRideEarning')} value={todayAnalytics?.last_ride_earnings == null ? '—' : formatFare(todayAnalytics.last_ride_earnings)} last /></Pressable>}
        {expandedMetric === 'trips' && <Pressable onPress={() => setExpandedMetric(null)} style={analyticsStyles.accordion}><View style={analyticsStyles.accordionHeader}><Text style={analyticsStyles.accordionTitle}>{t('captain.todayTrips')}</Text><ChevronDown color={colors.textPrimary} size={22} /></View><AnalyticsRow Icon={CarFront} label={t('captain.todayTrips')} value={String(todayAnalytics?.completed_rides ?? today.trips)} /><AnalyticsRow Icon={Route} label={t('captain.kmsDriven')} value={`${((todayAnalytics?.ride_km ?? 0) + (todayAnalytics?.pickup_km ?? 0)).toFixed(1)} km`} /><AnalyticsRow Icon={Route} label={t('captain.lastRideKm')} value={todayAnalytics?.last_ride_km == null ? '—' : `${Number(todayAnalytics.last_ride_km).toFixed(1)} km`} last /></Pressable>}
        <Text style={styles.sheetHint}>{t('captain.homeSheetHint')}</Text>
    </DraggableMapSheet>}
    <View style={[styles.tabBar, { minHeight: tabBarHeight, paddingBottom: 11 + bottomInset }]}>
      <CaptainTab Icon={House} label={t('captain.tabHome')} active />
      <CaptainTab Icon={BookOpen} label={t('captain.tabBookings')} onPress={showBookings} />
      <CaptainTab Icon={IndianRupee} label={t('captain.tabEarnings')} onPress={showEarnings} />
      <CaptainTab Icon={UserRound} label={t('captain.tabProfile')} onPress={onSettings} />
    </View>
  </SafeAreaView>;
}
export function CaptainBookingsScreen({ onHome, onSettings, onEarnings, onResumeRide, onOpenRideDetails }: { onHome: () => void; onSettings: () => void; onEarnings: () => void; onResumeRide: (ride: CaptainActiveRide) => void; onOpenRideDetails: (rideId: string) => void }) {
  const { t, i18n } = useTranslation(); const { bottomInset, tabBarHeight } = useBottomTabBarMetrics(); const [rides, setRides] = useState<DispatchRide[]>([]); const [filter, setFilter] = useState<RideHistoryFilter>('all');
  useFocusEffect(React.useCallback(() => { void rideDispatchService.getCaptainRideHistory().then(setRides).catch(() => setRides([])); }, []));
  const resume = async () => { const current = await rideDispatchService.getCaptainActiveRide(); if (current) onResumeRide(current); };
  const filteredRides = filterAndSortRideHistory(rides, filter);
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}><ScrollView contentContainerStyle={[styles.bookings, { paddingBottom: tabBarHeight + 24 }]}><Text style={styles.bookingsTitle}>{t('captain.bookingsTitle')}</Text><RideHistoryFilterControl value={filter} onChange={setFilter} />{filter !== 'all' && <Text style={styles.bookingsPeriod}>{t('history.showing')} {rideHistoryPeriodLabel(filter, new Date(), i18n.language)}</Text>}{filteredRides.length ? filteredRides.map((ride) => { const active = ['accepted', 'arrived', 'in_progress'].includes(ride.status); const completed = ride.status === 'completed'; return <Pressable key={ride.id} accessibilityRole="button" onPress={() => { if (active) void resume(); }} style={[styles.booking, shadows.card]}><Text style={styles.bookingStatus}>{t(`captain.status${ride.status}`)}</Text><Text style={styles.bookingRoute} numberOfLines={1}>{ride.pickup_address}</Text><Text style={styles.bookingArrow}>→</Text><Text style={styles.bookingRoute} numberOfLines={1}>{ride.drop_address}</Text>{active && <Text style={styles.bookingAction}>{t('captain.viewBooking')} ›</Text>}{completed && <Pressable accessibilityRole="button" onPress={() => onOpenRideDetails(ride.id)} style={styles.bookingDetailsButton}><Text style={styles.bookingDetailsButtonText}>{t('rides.rideDetails')}</Text></Pressable>}</Pressable>; }) : <Text style={styles.bookingsEmpty}>{filter === 'all' ? t('captain.bookingsEmpty') : t('history.empty')}</Text>}</ScrollView><View style={[styles.tabBar, { minHeight: tabBarHeight, paddingBottom: 11 + bottomInset }]}><CaptainTab Icon={House} label={t('captain.tabHome')} onPress={onHome} /><CaptainTab Icon={BookOpen} label={t('captain.tabBookings')} active /><CaptainTab Icon={IndianRupee} label={t('captain.tabEarnings')} onPress={onEarnings} /><CaptainTab Icon={UserRound} label={t('captain.tabProfile')} onPress={onSettings} /></View></SafeAreaView>;
}
function CaptainTab({ Icon, label, active, onPress }: { Icon: LucideIcon; label: string; active?: boolean; onPress?: () => void }) {
  const color = active ? colors.primary : colors.textMuted;
  return <Pressable disabled={!onPress} onPress={() => { if (onPress) { selectionHaptic(); onPress(); } }} accessibilityRole="button" accessibilityState={{ selected: active }} style={styles.tab}><Icon color={color} size={23} strokeWidth={active ? 2.5 : 2} /><Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ safe: { backgroundColor: colors.bg, flex: 1 }, header: { padding: layout.screenHorizontalPadding }, badge: { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8 }, onlineBadge: { backgroundColor: colors.success }, offlineBadge: { backgroundColor: '#6B7280' }, badgeText: { color: colors.textOnPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, fontWeight: '800' }, locationNotice: { alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, marginTop: 6, paddingHorizontal: 16, paddingVertical: 10 }, locationText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, left: 0, maxHeight: '70%', minHeight: 238, position: 'absolute', right: 0 }, handle: { alignSelf: 'center', backgroundColor: colors.border, borderRadius: 3, height: 5, marginTop: 10, width: 42 }, sheetContent: { flexGrow: 1, gap: layout.compactGap, padding: layout.screenHorizontalPadding }, bottomTitle: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.lg, fontWeight: '900' }, bottomDetail: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, toggle: { alignItems: 'center', borderRadius: radii.pill, flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 4, minHeight: 56, paddingHorizontal: 18 }, toggleOnline: { backgroundColor: colors.primary }, toggleOffline: { backgroundColor: '#6B7280' }, toggleDisabled: { opacity: 0.65 }, knob: { backgroundColor: '#FFFFFF', borderRadius: 11, height: 22, width: 22 }, knobOnline: { backgroundColor: colors.surfaceMint }, toggleText: { color: colors.textOnPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md, fontWeight: '900' }, availabilityError: { color: colors.accent, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' }, summaryRow: { flexDirection: 'row', gap: layout.compactGap, marginTop: 2 }, summaryCard: { backgroundColor: colors.bg, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, padding: 11 }, summaryValue: { color: colors.primaryDark, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md, fontWeight: '900' }, summaryLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, marginTop: 1 }, sheetHint: { color: colors.textMuted, fontFamily, fontSize: fontSize.xs, lineHeight: 18, marginTop: 0 }, bookings: { gap: 12, padding: layout.screenHorizontalPadding }, bookingsTitle: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize['2xl'], fontWeight: '900' }, bookingsPeriod: { color: colors.primaryDark, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, fontWeight: '800', marginTop: -6 }, bookingsEmpty: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md }, booking: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: 5, padding: layout.cardPaddingVertical }, bookingStatus: { color: colors.primary, fontFamily: fontFamilyBold, fontSize: fontSize.sm, fontWeight: '900' }, bookingRoute: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, fontWeight: '800' }, bookingArrow: { color: colors.textMuted, fontSize: 18 }, bookingAction: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm, fontWeight: '900', marginTop: 4 }, bookingDetailsButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, marginTop: 6, minHeight: 44, justifyContent: 'center' }, bookingDetailsButtonText: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm, fontWeight: '800' }, tabBar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, elevation: 10, flexDirection: 'row', justifyContent: 'space-around', left: 0, paddingTop: 9, position: 'absolute', right: 0, zIndex: 10 }, tab: { alignItems: 'center', flex: 1, gap: 2, justifyContent: 'center', minWidth: 0 }, tabIcon: { color: colors.textMuted, fontSize: 23, lineHeight: 25 }, tabIconActive: { color: colors.primary }, tabLabel: { color: colors.textMuted, fontFamily, fontSize: 11 }, tabLabelActive: { color: colors.primaryDark, fontFamily: fontFamilySemiBold, fontWeight: '800' }, recenterButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, height: 50, justifyContent: 'center', position: 'absolute', right: 18, top: 76, width: 50, zIndex: 2 } });
