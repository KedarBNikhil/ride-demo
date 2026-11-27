import * as Location from 'expo-location';
import MapView from 'react-native-maps';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutAnimation, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
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
import { BookOpen, CarFront, Crosshair, Gift, House, IndianRupee, ReceiptText, Route, type LucideIcon, UserRound } from 'lucide-react-native';
const analyticsStyles = StyleSheet.create({ metricTile: { alignSelf: 'flex-start', backgroundColor: colors.bg, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexBasis: 0, flexGrow: 1, flexShrink: 1, minHeight: 92, padding: 11 }, metricTileExpanded: { flexGrow: 0, flexShrink: 0 }, metricDetails: { marginTop: 8 }, analyticsRow: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 40 }, lastRow: { borderBottomWidth: 0 }, analyticsLabel: { color: colors.textSecondary, flex: 1, fontFamily, fontSize: fontSize.sm }, analyticsValue: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm, fontWeight: '900' } });
function AnalyticsRow({ Icon, label, value, last }: { Icon: LucideIcon; label: string; value: string; last?: boolean }) { return <View style={[analyticsStyles.analyticsRow, last && analyticsStyles.lastRow]}><Icon color={colors.primaryDark} size={19} /><Text style={analyticsStyles.analyticsLabel}>{label}</Text><Text style={analyticsStyles.analyticsValue}>{value}</Text></View>; }
export function CaptainDashboardScreen({ online, timeoutNotice, onToggle, onSettings, onBookings, onEarnings, onRequest, request, onAccept, onReject, requestCycle, onResumeRide }: { online: boolean; timeoutNotice?: string | null; onToggle: () => void; onSettings: () => void; onBookings?: () => void; onEarnings?: () => void; onRequest: (request: CaptainRideRequest | null) => void; request: CaptainRideRequest | null; onAccept: () => Promise<void>; onReject: () => void; requestCycle: number; onResumeRide?: (ride: CaptainActiveRide) => void }) {
  const { t } = useTranslation(); const { bottomInset, tabBarHeight } = useBottomTabBarMetrics(); const mapRef = useRef<MapView>(null); const [location, setLocation] = useState<LiveCoordinate | null>(null); const [locationUnavailable, setLocationUnavailable] = useState(false); const [availabilitySaving, setAvailabilitySaving] = useState(false); const [availabilityError, setAvailabilityError] = useState(false); const [today, setToday] = useState({ earnings: 0, trips: 0, bonuses: 0 }); const [todayAnalytics, setTodayAnalytics] = useState<Awaited<ReturnType<typeof captainEarningsService.getDailyAnalytics>>>(null); const [expandedMetric, setExpandedMetric] = useState<'earnings' | 'trips' | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [wallet, setWallet] = useState<Array<{ id: string; ride_id: string; amount_paise: number; status: string; created_at: string; review_note: string | null }>>([]);
  const [walletError, setWalletError] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const refreshWallet = useCallback(async () => {
    if (!supabase) { setWalletError('Wallet unavailable. Please try again.'); return; }
    const { data, error } = await supabase.rpc('captain_wallet_snapshot');
    if (error) { setWalletError('Wallet unavailable. Please try again.'); return; }
    setWalletError(''); setWallet(data ?? []);
  }, []);
  useFocusEffect(useCallback(() => { void refreshWallet(); const timer = setInterval(() => void refreshWallet(), 30000); return () => clearInterval(timer); }, [refreshWallet]));
  useEffect(() => rideDispatchService.subscribeToCaptainRides(() => { void refreshWallet(); }), [refreshWallet]);
  const requestCashout = async (id: string) => {
    if (!supabase || walletBusy) return;
    setWalletBusy(true); setWalletError('');
    const { error } = await supabase.rpc('captain_wallet_request_cashout', { p_credit_id: id });
    if (error) setWalletError('Unable to request cash out. Check your approved payout details and try again.');
    await refreshWallet(); if (error) setWalletError('Unable to request cash out. Check your approved payout details and try again.');
    setWalletBusy(false);
  };
  const walletBalance = wallet.filter((item) => ['pending', 'approved'].includes(item.status)).reduce((sum, item) => sum + item.amount_paise, 0) / 100;
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
  const refreshToday = useCallback(() => { void Promise.all([captainEarningsService.getToday(), captainEarningsService.getDailyAnalytics()]).then(([overview, analytics]) => { setToday({ earnings: overview.totalEarnings, trips: overview.tripCount, bonuses: overview.bonuses ?? 0 }); setTodayAnalytics(analytics); }).catch(() => undefined); }, []);
  useFocusEffect(useCallback(() => { refreshToday(); const timer = setInterval(refreshToday, 30000); return () => clearInterval(timer); }, [refreshToday]));
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
  const toggleMetric = (metric: 'earnings' | 'trips') => { selectionHaptic(); LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpandedMetric((current) => current === metric ? null : metric); };
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <LiveLocationMap mapRef={mapRef} location={location} />
    <View style={styles.header}>
      <View style={[styles.badge, online ? styles.onlineBadge : styles.offlineBadge]}><Text style={styles.badgeText}>{online ? t('captain.onlineWaiting') : t('captain.offlineStatus')}</Text></View>
    </View>
    {!!timeoutNotice && <View style={[styles.locationNotice, shadows.card]}><Text style={styles.locationText}>{timeoutNotice}</Text></View>}
    <Pressable accessibilityRole="button" accessibilityLabel={t('home.recenter')} disabled={!location} onPress={() => { selectionHaptic(); recenterOnLocation(); }} style={[styles.recenterButton, shadows.card, !location && { opacity: 0.5 }]}><Crosshair color={colors.primary} size={25} /></Pressable>
    {locationUnavailable && <View style={[styles.locationNotice, shadows.card]}><Text style={styles.locationText}>{t('home.locationUnavailable')}</Text></View>}
    {request ? <IncomingRideRequestSheet request={request} onAccept={onAccept} onReject={onReject} bottomOffset={tabBarHeight} /> : <DraggableMapSheet bottom={tabBarHeight} collapsedHeight={238} expandOnChange={expandedMetric} style={shadows.card} contentContainerStyle={[styles.sheetContent, { paddingBottom: 20 + bottomInset }]}>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: online, disabled: availabilitySaving }} disabled={availabilitySaving} onPress={() => { selectionHaptic(); void toggleAvailability(); }} style={[styles.toggle, online ? styles.toggleOnline : styles.toggleOffline, availabilitySaving && styles.toggleDisabled]}><View style={[styles.knob, online && styles.knobOnline]} /><Text style={styles.toggleText}>{t(availabilitySaving ? 'captain.updatingAvailability' : online ? 'captain.goOffline' : 'captain.goOnline')}</Text></Pressable>
        {availabilityError && <Text accessibilityRole="alert" style={styles.availabilityError}>{t('captain.availabilityUpdateFailed')}</Text>}
        <View key={expandedMetric ? 'expanded' : 'collapsed'} style={[styles.summaryRow, expandedMetric && { flexDirection: expandedMetric === 'trips' ? 'column-reverse' : 'column', flexWrap: 'nowrap' }]}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedMetric === 'earnings' }} onPress={() => toggleMetric('earnings')} style={[analyticsStyles.metricTile, expandedMetric && { width: '100%', flexBasis: 'auto', flexGrow: 0, flexShrink: 0 }, expandedMetric === 'earnings' && analyticsStyles.metricTileExpanded]}><Text style={styles.summaryValue}>{formatFare(today.earnings)}</Text><Text style={styles.summaryLabel}>{t('captain.todayEarnings')}</Text>{expandedMetric === 'earnings' && <View style={analyticsStyles.metricDetails}><AnalyticsRow Icon={CarFront} label={t('captain.tripEarnings')} value={formatFare(todayAnalytics?.total_earnings ?? (today.earnings - today.bonuses))} /><AnalyticsRow Icon={Gift} label={t('captain.bonuses')} value={formatFare(today.bonuses)} /><AnalyticsRow Icon={IndianRupee} label={t('captain.totalToday')} value={formatFare(today.earnings)} /><AnalyticsRow Icon={ReceiptText} label={t('captain.lastRideEarning')} value={todayAnalytics?.last_ride_earnings == null ? '—' : formatFare(todayAnalytics.last_ride_earnings)} last /></View>}</Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedMetric === 'trips' }} onPress={() => toggleMetric('trips')} style={[analyticsStyles.metricTile, expandedMetric && { width: '100%', flexBasis: 'auto', flexGrow: 0, flexShrink: 0 }, expandedMetric === 'trips' && analyticsStyles.metricTileExpanded]}><Text style={styles.summaryValue}>{today.trips}</Text><Text style={styles.summaryLabel}>{t('captain.todayTrips')}</Text>{expandedMetric === 'trips' && <View style={analyticsStyles.metricDetails}><AnalyticsRow Icon={CarFront} label={t('captain.todayTrips')} value={String(todayAnalytics?.completed_rides ?? today.trips)} /><AnalyticsRow Icon={Route} label={t('captain.kmsDriven')} value={`${((todayAnalytics?.ride_km ?? 0) + (todayAnalytics?.pickup_km ?? 0)).toFixed(1)} km`} /><AnalyticsRow Icon={Route} label={t('captain.lastRideKm')} value={todayAnalytics?.last_ride_km == null ? '—' : `${Number(todayAnalytics.last_ride_km).toFixed(1)} km`} last /></View>}</Pressable>
          <Pressable accessibilityRole="button" onPress={() => { setWalletOpen(true); void refreshWallet(); }} style={[analyticsStyles.metricTile, expandedMetric && { width: '100%', flexBasis: 'auto', flexGrow: 0, flexShrink: 0 }]}><Text style={styles.summaryValue}>{walletError ? '—' : formatFare(walletBalance)}</Text><Text style={styles.summaryLabel}>Wallet</Text></Pressable>
        </View>
        <Text style={styles.sheetHint}>{t('captain.homeSheetHint')}</Text>
    </DraggableMapSheet>}
    <Modal visible={walletOpen} animationType="slide" onRequestClose={() => setWalletOpen(false)}>
      <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.bookings}>
        <Pressable accessibilityRole="button" onPress={() => setWalletOpen(false)}><Text style={styles.bookingAction}>‹ Back</Text></Pressable>
        <Text style={styles.bookingsTitle}>Wallet</Text>
        <Text style={styles.bottomDetail}>Bonuses are shown immediately. Verification may take up to 3 days; only approved bonuses can be cashed out.</Text>
        <Text style={styles.bottomTitle}>Wallet balance: {formatFare(walletBalance)}</Text>
        {!!walletError && <Text accessibilityRole="alert" style={styles.availabilityError}>{walletError}</Text>}
        {wallet.length === 0 && !walletError ? <Text style={styles.bookingsEmpty}>No bonus credits yet.</Text> : null}
        {wallet.map((item) => <View key={item.id} style={styles.booking}>
          <Text style={styles.summaryValue}>+{formatFare(item.amount_paise / 100)} · Ride bonus</Text>
          <Text style={styles.bottomDetail}>{new Date(item.created_at).toLocaleDateString()} · {({ pending: 'Pending verification', approved: 'Available to cash out', rejected: 'Not approved', requested: 'Cash out requested', paid: 'Paid' } as Record<string, string>)[item.status] ?? item.status}</Text>
          {!!item.review_note && item.status === 'rejected' && <Text style={styles.bottomDetail}>{item.review_note}</Text>}
          {item.status === 'approved' && <Pressable accessibilityRole="button" disabled={walletBusy} onPress={() => void requestCashout(item.id)} style={styles.bookingDetailsButton}><Text style={styles.bookingDetailsButtonText}>{walletBusy ? 'Requesting…' : 'Cash out to saved payout account'}</Text></Pressable>}
        </View>)}
        <Text style={styles.bottomDetail}>Cash-out requests are paid manually to your approved UPI or bank account.</Text>
      </ScrollView></SafeAreaView>
    </Modal>
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
const styles = StyleSheet.create({ safe: { backgroundColor: colors.bg, flex: 1 }, header: { padding: layout.screenHorizontalPadding }, badge: { alignSelf: 'flex-start', borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 8 }, onlineBadge: { backgroundColor: colors.success }, offlineBadge: { backgroundColor: '#6B7280' }, badgeText: { color: colors.textOnPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, fontWeight: '800' }, locationNotice: { alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, marginTop: 6, paddingHorizontal: 16, paddingVertical: 10 }, locationText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, left: 0, maxHeight: '70%', minHeight: 238, position: 'absolute', right: 0 }, handle: { alignSelf: 'center', backgroundColor: colors.border, borderRadius: 3, height: 5, marginTop: 10, width: 42 }, sheetContent: { flexGrow: 1, gap: layout.compactGap, padding: layout.screenHorizontalPadding }, bottomTitle: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.lg, fontWeight: '900' }, bottomDetail: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, toggle: { alignItems: 'center', borderRadius: radii.pill, flexDirection: 'row', gap: 10, justifyContent: 'center', marginTop: 4, minHeight: 56, paddingHorizontal: 18 }, toggleOnline: { backgroundColor: colors.primary }, toggleOffline: { backgroundColor: '#6B7280' }, toggleDisabled: { opacity: 0.65 }, knob: { backgroundColor: '#FFFFFF', borderRadius: 11, height: 22, width: 22 }, knobOnline: { backgroundColor: colors.surfaceMint }, toggleText: { color: colors.textOnPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md, fontWeight: '900' }, availabilityError: { color: colors.accent, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' }, summaryRow: { alignContent: 'flex-start', alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: layout.compactGap, marginTop: 2 }, summaryCard: { backgroundColor: colors.bg, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, padding: 11 }, summaryValue: { color: colors.primaryDark, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md, fontWeight: '900' }, summaryLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, marginTop: 1 }, sheetHint: { color: colors.textMuted, fontFamily, fontSize: fontSize.xs, lineHeight: 18, marginTop: 0 }, bookings: { gap: 12, padding: layout.screenHorizontalPadding }, bookingsTitle: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize['2xl'], fontWeight: '900' }, bookingsPeriod: { color: colors.primaryDark, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, fontWeight: '800', marginTop: -6 }, bookingsEmpty: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md }, booking: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: 5, padding: layout.cardPaddingVertical }, bookingStatus: { color: colors.primary, fontFamily: fontFamilyBold, fontSize: fontSize.sm, fontWeight: '900' }, bookingRoute: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, fontWeight: '800' }, bookingArrow: { color: colors.textMuted, fontSize: 18 }, bookingAction: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm, fontWeight: '900', marginTop: 4 }, bookingDetailsButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, marginTop: 6, minHeight: 44, justifyContent: 'center' }, bookingDetailsButtonText: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm, fontWeight: '800' }, tabBar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, elevation: 10, flexDirection: 'row', justifyContent: 'space-around', left: 0, paddingTop: 9, position: 'absolute', right: 0, zIndex: 10 }, tab: { alignItems: 'center', flex: 1, gap: 2, justifyContent: 'center', minWidth: 0 }, tabIcon: { color: colors.textMuted, fontSize: 23, lineHeight: 25 }, tabIconActive: { color: colors.primary }, tabLabel: { color: colors.textMuted, fontFamily, fontSize: 11 }, tabLabelActive: { color: colors.primaryDark, fontFamily: fontFamilySemiBold, fontWeight: '800' }, recenterButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, height: 50, justifyContent: 'center', position: 'absolute', right: 18, top: 76, width: 50, zIndex: 2 } });
