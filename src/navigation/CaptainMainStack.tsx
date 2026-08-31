import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AppLanguage } from '../i18n/createI18n';
import { CaptainBookingsScreen, CaptainDashboardScreen } from '../screens/captain/CaptainDashboardScreen';
import { CaptainEarningsScreen } from '../screens/captain/CaptainEarningsScreen';
import { ToPickupScreen } from '../screens/captain/ToPickupScreen';
import { StartRideScreen } from '../screens/captain/StartRideScreen';
import { TripInProgressScreen } from '../screens/captain/TripInProgressScreen';
import { EndRideScreen } from '../screens/captain/EndRideScreen';
import { CaptainRideDetailsScreen } from '../screens/captain/CaptainRideDetailsScreen';
import { RateCustomerScreen } from '../screens/captain/RateCustomerScreen';
import { CaptainRideChat } from '../components/CaptainRideChat';
import type { CaptainRideRequest, DispatchRide } from '../services/rideDispatch';
import { rideDispatchService } from '../services/rideDispatch';
import { subscribeToCaptainOfferNotificationResponses } from '../services/pushNotifications';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { useDialog } from '../components/ThemedDialog';
import { useTranslation } from 'react-i18next';
import { colors, fontFamily, radii } from '../theme';
import { selectionHaptic } from '../utils/haptics';

const Stack = createNativeStackNavigator();

const cancellationReasonKeys: Record<string, string> = {
  change_plans: 'rides.cancelReasonChangePlans',
  another_ride: 'rides.cancelReasonAnotherRide',
  wait_time: 'rides.cancelReasonWaitTime',
  fare_concern: 'rides.cancelReasonFare',
  captain_unreachable: 'rides.cancelReasonCaptain',
  other: 'rides.cancelReasonOther',
};

function CaptainRideCancellationGuard({ rideId, onCancelled, onReleased, onSurchargeTimeout, children }: { rideId: string; onCancelled: (ride: DispatchRide) => void; onReleased: () => void; onSurchargeTimeout?: () => void; children: React.ReactNode }) {
  useEffect(() => rideDispatchService.subscribeToRide(rideId, (ride) => {
    if (ride.status === 'cancelled' && ride.fare_approval_status === 'declined' && ride.cancellation_reason_detail === 'Customer did not confirm updated captain-distance fare within 30 seconds') onSurchargeTimeout?.();
    else if (ride.status === 'cancelled') onCancelled(ride);
    else if (ride.status === 'searching') onReleased();
  }), [onCancelled, onReleased, onSurchargeTimeout, rideId]);
  return <>{children}</>;
}

function CaptainRideCancelledSheet({ ride, onDone }: { ride: DispatchRide; onDone: () => void }) {
  const { t } = useTranslation();
  const reasonKey = ride.cancellation_reason_code ? cancellationReasonKeys[ride.cancellation_reason_code] : undefined;
  const reason = reasonKey ? t(reasonKey) : ride.cancellation_reason_detail || t('captain.customerCancelledRide');
  return <View style={cancellationStyles.overlay}>
    <View style={cancellationStyles.sheet}>
      <View style={cancellationStyles.handle} />
      <Text style={cancellationStyles.icon}>✕</Text>
      <Text style={cancellationStyles.title}>{t('captain.rideCancelledTitle')}</Text>
      <Text style={cancellationStyles.message}>{t('captain.customerCancelledRide')}</Text>
      <View style={cancellationStyles.reasonCard}><Text style={cancellationStyles.reasonLabel}>{t('captain.cancellationReason')}</Text><Text style={cancellationStyles.reasonText}>{reason}</Text></View>
      {Number(ride.cancellation_charge ?? 0) > 0 && <Text style={cancellationStyles.charge}>{t('captain.cancellationCharge', { charge: `₹${Number(ride.cancellation_charge).toFixed(2)}` })}</Text>}
      <Pressable onPress={onDone} accessibilityRole="button" style={cancellationStyles.doneButton}><Text style={cancellationStyles.doneButtonText}>{t('actions.done')}</Text></Pressable>
    </View>
  </View>;
}

function CaptainRideCancellationFlow({ rideId, onDone, onSurchargeTimeout, children }: { rideId: string; onDone: () => void; onSurchargeTimeout?: () => void; children: React.ReactNode }) {
  const [cancelledRide, setCancelledRide] = useState<DispatchRide | null>(null);
  return <CaptainRideCancellationGuard rideId={rideId} onCancelled={setCancelledRide} onReleased={onDone} onSurchargeTimeout={onSurchargeTimeout}><View style={{ flex: 1 }}>{children}{cancelledRide && <CaptainRideCancelledSheet ride={cancelledRide} onDone={onDone} />}</View></CaptainRideCancellationGuard>;
}

function CaptainActiveTabBar({ onHome, onBookings, onEarnings, onSettings }: { onHome: () => void; onBookings: () => void; onEarnings: () => void; onSettings: () => void }) {
  const { t } = useTranslation();
  return <View style={activeTabStyles.bar}><CaptainActiveTab icon="⌂" label={t('captain.tabHome')} onPress={onHome} /><CaptainActiveTab icon="▤" label={t('captain.tabBookings')} active onPress={onBookings} /><CaptainActiveTab icon="₹" label={t('captain.tabEarnings')} onPress={onEarnings} /><CaptainActiveTab icon="♙" label={t('captain.tabProfile')} onPress={onSettings} /></View>;
}
function CaptainActiveTab({ icon, label, active, onPress }: { icon: string; label: string; active?: boolean; onPress: () => void }) {
  return <Pressable onPress={() => { selectionHaptic(); onPress(); }} accessibilityRole="button" accessibilityState={{ selected: active }} style={activeTabStyles.tab}><Text style={[activeTabStyles.icon, active && activeTabStyles.active]}>{icon}</Text><Text style={[activeTabStyles.label, active && activeTabStyles.activeLabel]} numberOfLines={1}>{label}</Text></Pressable>;
}
const activeTabStyles = StyleSheet.create({ bar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', left: 0, minHeight: 76, paddingBottom: 11, paddingTop: 9, position: 'absolute', right: 0, zIndex: 30 }, tab: { alignItems: 'center', flex: 1, gap: 2, minWidth: 0 }, icon: { color: colors.textMuted, fontSize: 23, lineHeight: 25 }, active: { color: colors.primary }, label: { color: colors.textMuted, fontFamily, fontSize: 11 }, activeLabel: { color: colors.primaryDark, fontWeight: '800' } });
const cancellationStyles = StyleSheet.create({ overlay: { alignItems: 'center', backgroundColor: 'rgba(19, 39, 35, 0.52)', bottom: 0, justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 60 }, sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, gap: 14, padding: 22, paddingBottom: 34, width: '100%' }, handle: { alignSelf: 'center', backgroundColor: colors.border, borderRadius: radii.pill, height: 5, marginBottom: 4, width: 46 }, icon: { alignSelf: 'center', backgroundColor: '#FDE9E6', borderRadius: radii.pill, color: colors.accent, fontSize: 25, fontWeight: '900', height: 52, lineHeight: 52, overflow: 'hidden', textAlign: 'center', width: 52 }, title: { color: colors.textPrimary, fontFamily, fontSize: 22, fontWeight: '800', textAlign: 'center' }, message: { color: colors.textSecondary, fontFamily, fontSize: 15, lineHeight: 22, textAlign: 'center' }, reasonCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: 4, padding: 14 }, reasonLabel: { color: colors.textSecondary, fontFamily, fontSize: 12, fontWeight: '700' }, reasonText: { color: colors.textPrimary, fontFamily, fontSize: 16, fontWeight: '800' }, charge: { color: colors.accent, fontFamily, fontSize: 14, fontWeight: '700', textAlign: 'center' }, doneButton: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: radii.md, minHeight: 52, justifyContent: 'center', marginTop: 4 }, doneButtonText: { color: colors.bg, fontFamily, fontSize: 16, fontWeight: '800' } });

export function CaptainMainStack({ online, onToggle, onLanguageChange, onTripComplete, onAccountDeleted }: { online: boolean; onToggle: () => void; onLanguageChange: (language: AppLanguage) => Promise<void>; onTripComplete: () => void; onAccountDeleted: () => void }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [request, setRequest] = useState<CaptainRideRequest | null>(null);
  const [requestCycle, setRequestCycle] = useState(0);
  const [surchargeTimeoutNotice, setSurchargeTimeoutNotice] = useState<string | null>(null);
  const acceptingOfferId = useRef<string | null>(null);
  const dismissRequest = useCallback(() => { setRequest(null); setRequestCycle((cycle) => cycle + 1); }, []);
  const releaseAfterSurchargeTimeout = useCallback(() => { onTripComplete(); setSurchargeTimeoutNotice(t('captain.surchargeNotAccepted')); }, [onTripComplete, t]);
  useEffect(() => {
    if (!surchargeTimeoutNotice) return;
    const timer = setTimeout(() => setSurchargeTimeoutNotice(null), 5_000);
    return () => clearTimeout(timer);
  }, [surchargeTimeoutNotice]);
  useEffect(() => subscribeToCaptainOfferNotificationResponses(({ rideId, offerId }) => {
    void rideDispatchService.getCaptainPendingOffer(rideId, offerId).then((offer) => {
      if (offer) setRequest(offer);
    }).catch(() => undefined);
  }), []);
  return <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 260 }}>
    <Stack.Screen name="CaptainHome">{({ navigation }) => <CaptainDashboardScreen online={online} timeoutNotice={surchargeTimeoutNotice} onToggle={onToggle} onSettings={() => navigation.navigate('Settings')} onBookings={() => navigation.navigate('CaptainBookings')} onEarnings={() => navigation.navigate('CaptainEarnings')} onRequest={setRequest} request={request} requestCycle={requestCycle} onResumeRide={(ride) => { if (ride.status === 'accepted') navigation.navigate('ToPickup', { request: ride }); else if (ride.status === 'arrived') navigation.navigate('StartRide', { request: ride }); else navigation.navigate('TripInProgress', { request: ride }); }} onReject={() => { const active = request; dismissRequest(); if (active) void rideDispatchService.respondToOffer(active.offerId, false); }} onAccept={async () => { const active = request; if (!active || acceptingOfferId.current) return; acceptingOfferId.current = active.offerId; try { await rideDispatchService.respondToOffer(active.offerId, true); dismissRequest(); navigation.navigate('ToPickup', { request: active }); } catch (error) { const message = error instanceof Error ? error.message : ''; const unavailable = message.includes('Ride was already accepted') || message.includes('Offer is no longer available'); if (unavailable) { dismissRequest(); dialog({ title: 'Ride already accepted', message: 'Ride already accepted by another captain.', buttons: [{ text: 'OK', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'CaptainHome' }] }) }] }); } else dialog({ title: t('login.tryAgain') }); } finally { acceptingOfferId.current = null; } }} />}</Stack.Screen>
    <Stack.Screen name="CaptainBookings">{({ navigation }) => <CaptainBookingsScreen onHome={() => navigation.navigate('CaptainHome')} onSettings={() => navigation.navigate('Settings')} onEarnings={() => navigation.navigate('CaptainEarnings')} onOpenRideDetails={(rideId) => navigation.navigate('CaptainRideDetails', { rideId })} onResumeRide={(ride) => { if (ride.status === 'accepted') navigation.navigate('ToPickup', { request: ride }); else if (ride.status === 'arrived') navigation.navigate('StartRide', { request: ride }); else navigation.navigate('TripInProgress', { request: ride }); }} />}</Stack.Screen>
    <Stack.Screen name="CaptainRideDetails">{({ navigation, route }) => <CaptainRideDetailsScreen rideId={(route.params as { rideId: string }).rideId} onBack={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="CaptainEarnings">{({ navigation }) => <CaptainEarningsScreen onHome={() => navigation.navigate('CaptainHome')} onBookings={() => navigation.navigate('CaptainBookings')} onSettings={() => navigation.navigate('Settings')} />}</Stack.Screen>
    <Stack.Screen name="ToPickup">{({ navigation, route }) => { const params = route.params as { request: CaptainRideRequest; arrived?: boolean }; const active = params.request; const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'CaptainHome' }] }); const onSurchargeTimeout = () => { releaseAfterSurchargeTimeout(); goHome(); }; return <CaptainRideCancellationFlow rideId={active.rideId} onDone={goHome} onSurchargeTimeout={onSurchargeTimeout}><ToPickupScreen request={active} arrived={params.arrived} onBack={() => navigation.goBack()} onOpenChat={() => navigation.navigate('CaptainRideChat', { rideId: active.rideId, customerName: active.customerName })} onPrimaryAction={() => { if (params.arrived) navigation.navigate('StartRide', { request: active }); else void rideDispatchService.transitionRide(active.rideId, 'arrived').then(() => navigation.navigate('StartRide', { request: active })); }} /><CaptainActiveTabBar onHome={goHome} onBookings={() => navigation.navigate('CaptainBookings')} onEarnings={() => navigation.navigate('CaptainEarnings')} onSettings={() => navigation.navigate('Settings')} /></CaptainRideCancellationFlow>; }}</Stack.Screen>
    <Stack.Screen name="StartRide">{({ navigation, route }) => { const active = (route.params as { request: CaptainRideRequest }).request; const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'CaptainHome' }] }); return <CaptainRideCancellationFlow rideId={active.rideId} onDone={goHome}><StartRideScreen onBack={() => navigation.replace('ToPickup', { request: active, arrived: true })} onVerified={async (otp) => { await rideDispatchService.startRide(active.rideId, otp); navigation.navigate('TripInProgress', { request: active }); }} /><CaptainActiveTabBar onHome={goHome} onBookings={() => navigation.navigate('CaptainBookings')} onEarnings={() => navigation.navigate('CaptainEarnings')} onSettings={() => navigation.navigate('Settings')} /></CaptainRideCancellationFlow>; }}</Stack.Screen>
    <Stack.Screen name="TripInProgress">{({ navigation, route }) => { const active = (route.params as { request: CaptainRideRequest }).request; const goHome = () => navigation.reset({ index: 0, routes: [{ name: 'CaptainHome' }] }); return <CaptainRideCancellationFlow rideId={active.rideId} onDone={goHome}><TripInProgressScreen request={active} onBack={() => navigation.goBack()} onOpenChat={() => navigation.navigate('CaptainRideChat', { rideId: active.rideId, customerName: active.customerName })} onEndRide={() => { void rideDispatchService.transitionRide(active.rideId, 'completed').then(() => navigation.reset({ index: 0, routes: [{ name: 'EndRide', params: { rideId: active.rideId } }] })); }} /><CaptainActiveTabBar onHome={goHome} onBookings={() => navigation.navigate('CaptainBookings')} onEarnings={() => navigation.navigate('CaptainEarnings')} onSettings={() => navigation.navigate('Settings')} /></CaptainRideCancellationFlow>; }}</Stack.Screen>
    <Stack.Screen name="CaptainRideChat">{({ navigation, route }) => { const { rideId, customerName } = route.params as { rideId: string; customerName: string }; return <CaptainRideChat rideId={rideId} customerName={customerName} onBack={() => navigation.goBack()} />; }}</Stack.Screen>
    <Stack.Screen name="EndRide" options={{ gestureEnabled: false }}>{({ navigation, route }) => { const params = route.params as { rideId: string }; return <EndRideScreen rideId={params.rideId} onConfirmed={() => navigation.replace('RateCustomer', { rideId: params.rideId })} />; }}</Stack.Screen>
    <Stack.Screen name="RateCustomer" options={{ gestureEnabled: false }}>{({ navigation, route }) => <RateCustomerScreen rideId={(route.params as { rideId: string }).rideId} onDone={() => { onTripComplete(); navigation.reset({ index: 0, routes: [{ name: 'CaptainHome' }] }); }} />}</Stack.Screen>
    <Stack.Screen name="Settings">{({ navigation }) => <SettingsScreen profile ratingRole="captain" onBack={() => navigation.goBack()} onLanguageChange={(language) => { void onLanguageChange(language).then(() => navigation.goBack()); }} onAbout={() => navigation.navigate('About')} onAccountDeleted={onAccountDeleted} />}</Stack.Screen>
    <Stack.Screen name="About">{({ navigation }) => <AboutScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
  </Stack.Navigator>;
}
