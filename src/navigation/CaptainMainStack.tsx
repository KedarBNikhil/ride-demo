import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AppLanguage } from '../i18n/createI18n';
import { IncomingRequestScreen, RideInProgressScreen, RideSummaryScreen } from '../screens/CaptainScreens';
import { CaptainBookingsScreen, CaptainDashboardScreen } from '../screens/captain/CaptainDashboardScreen';
import { ToPickupScreen } from '../screens/captain/ToPickupScreen';
import { StartRideScreen } from '../screens/captain/StartRideScreen';
import { TripInProgressScreen, type TripSummary } from '../screens/captain/TripInProgressScreen';
import { EndRideScreen } from '../screens/captain/EndRideScreen';
import { RateCustomerScreen } from '../screens/captain/RateCustomerScreen';
import type { CaptainRideRequest, DispatchRide } from '../services/rideDispatch';
import { rideDispatchService } from '../services/rideDispatch';
import { subscribeToCaptainOfferNotificationResponses } from '../services/pushNotifications';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useTranslation } from 'react-i18next';
import { colors, fontFamily, radii } from '../theme';

const Stack = createNativeStackNavigator();
const cancellationMessage = (ride: DispatchRide) => `Reason: ${(ride.cancellation_reason_detail || ride.cancellation_reason_code || 'Customer cancelled').replace(/_/g, ' ')}${Number(ride.cancellation_charge ?? 0) > 0 ? `\nCancellation charge: ₹${Number(ride.cancellation_charge).toFixed(2)}` : ''}`;

function CaptainRideCancellationGuard({ rideId, onCancelled, children }: { rideId: string; onCancelled: (ride: DispatchRide) => void; children: React.ReactNode }) {
  useEffect(() => rideDispatchService.subscribeToRide(rideId, (ride) => { if (ride.status === 'cancelled') onCancelled(ride); }), [onCancelled, rideId]);
  return <>{children}</>;
}

function CaptainActiveTabBar({ onHome, onBookings, onSettings }: { onHome: () => void; onBookings: () => void; onSettings: () => void }) {
  const { t } = useTranslation();
  return <View style={activeTabStyles.bar}><CaptainActiveTab icon="⌂" label={t('captain.tabHome')} onPress={onHome} /><CaptainActiveTab icon="▤" label={t('captain.tabBookings')} active onPress={onBookings} /><CaptainActiveTab icon="₹" label={t('captain.tabEarnings')} onPress={() => Alert.alert(t('captain.earningsTitle'), t('captain.earningsMessage'))} /><CaptainActiveTab icon="♙" label={t('captain.tabProfile')} onPress={onSettings} /></View>;
}
function CaptainActiveTab({ icon, label, active, onPress }: { icon: string; label: string; active?: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={activeTabStyles.tab}><Text style={[activeTabStyles.icon, active && activeTabStyles.active]}>{icon}</Text><Text style={[activeTabStyles.label, active && activeTabStyles.activeLabel]} numberOfLines={1}>{label}</Text></Pressable>;
}
const activeTabStyles = StyleSheet.create({ bar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', left: 0, minHeight: 76, paddingBottom: 11, paddingTop: 9, position: 'absolute', right: 0, zIndex: 30 }, tab: { alignItems: 'center', flex: 1, gap: 2, minWidth: 0 }, icon: { color: colors.textMuted, fontSize: 23, lineHeight: 25 }, active: { color: colors.primary }, label: { color: colors.textMuted, fontFamily, fontSize: 11 }, activeLabel: { color: colors.primaryDark, fontWeight: '800' } });

export function CaptainMainStack({ online, onToggle, onLanguageChange, onTripComplete }: { online: boolean; onToggle: () => void; onLanguageChange: (language: AppLanguage) => Promise<void>; onTripComplete: () => void }) {
  const [request, setRequest] = useState<CaptainRideRequest | null>(null);
  const [requestCycle, setRequestCycle] = useState(0);
  const dismissRequest = useCallback(() => { setRequest(null); setRequestCycle((cycle) => cycle + 1); }, []);
  useEffect(() => subscribeToCaptainOfferNotificationResponses(({ rideId, offerId }) => {
    void rideDispatchService.getCaptainPendingOffer(rideId, offerId).then((offer) => {
      if (offer) setRequest(offer);
    }).catch(() => undefined);
  }), []);
  return <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 260 }}>
    <Stack.Screen name="CaptainHome">{({ navigation }) => <CaptainDashboardScreen online={online} onToggle={onToggle} onSettings={() => navigation.navigate('Settings')} onBookings={() => navigation.navigate('CaptainBookings')} onRequest={setRequest} request={request} requestCycle={requestCycle} onResumeRide={(ride) => { if (ride.status === 'accepted') navigation.navigate('ToPickup', { request: ride }); else if (ride.status === 'arrived') navigation.navigate('StartRide', { request: ride }); else navigation.navigate('TripInProgress', { request: ride }); }} onReject={() => { const active = request; dismissRequest(); if (active) void rideDispatchService.respondToOffer(active.offerId, false); }} onAccept={() => { const active = request; if (!active) return; void rideDispatchService.respondToOffer(active.offerId, true).then(() => { dismissRequest(); navigation.navigate('ToPickup', { request: active }); }); }} />}</Stack.Screen>
    <Stack.Screen name="CaptainBookings">{({ navigation }) => <CaptainBookingsScreen onHome={() => navigation.navigate('CaptainHome')} onSettings={() => navigation.navigate('Settings')} onResumeRide={(ride) => { if (ride.status === 'accepted') navigation.navigate('ToPickup', { request: ride }); else if (ride.status === 'arrived') navigation.navigate('StartRide', { request: ride }); else navigation.navigate('TripInProgress', { request: ride }); }} />}</Stack.Screen>
    <Stack.Screen name="ToPickup">{({ navigation, route }) => { const params = route.params as { request: CaptainRideRequest; arrived?: boolean }; const active = params.request; const cancelled = (ride: DispatchRide) => { Alert.alert('Ride cancelled', cancellationMessage(ride)); navigation.popToTop(); }; return <CaptainRideCancellationGuard rideId={active.rideId} onCancelled={cancelled}><View style={{ flex: 1 }}><ToPickupScreen request={active} arrived={params.arrived} onBack={() => navigation.goBack()} onPrimaryAction={() => { if (params.arrived) navigation.navigate('StartRide', { request: active }); else void rideDispatchService.transitionRide(active.rideId, 'arrived').then(() => navigation.navigate('StartRide', { request: active })); }} /><CaptainActiveTabBar onHome={() => navigation.popToTop()} onBookings={() => navigation.navigate('CaptainBookings')} onSettings={() => navigation.navigate('Settings')} /></View></CaptainRideCancellationGuard>; }}</Stack.Screen>
    <Stack.Screen name="StartRide">{({ navigation, route }) => { const active = (route.params as { request: CaptainRideRequest }).request; const cancelled = (ride: DispatchRide) => { Alert.alert('Ride cancelled', cancellationMessage(ride)); navigation.popToTop(); }; return <CaptainRideCancellationGuard rideId={active.rideId} onCancelled={cancelled}><View style={{ flex: 1 }}><StartRideScreen onBack={() => navigation.replace('ToPickup', { request: active, arrived: true })} onVerified={async (otp) => { await rideDispatchService.startRide(active.rideId, otp); navigation.navigate('TripInProgress', { request: active }); }} /><CaptainActiveTabBar onHome={() => navigation.popToTop()} onBookings={() => navigation.navigate('CaptainBookings')} onSettings={() => navigation.navigate('Settings')} /></View></CaptainRideCancellationGuard>; }}</Stack.Screen>
    <Stack.Screen name="TripInProgress">{({ navigation, route }) => { const active = (route.params as { request: CaptainRideRequest }).request; const cancelled = (ride: DispatchRide) => { Alert.alert('Ride cancelled', cancellationMessage(ride)); navigation.popToTop(); }; return <CaptainRideCancellationGuard rideId={active.rideId} onCancelled={cancelled}><View style={{ flex: 1 }}><TripInProgressScreen request={active} onBack={() => navigation.goBack()} onEndRide={(summary: TripSummary) => { void rideDispatchService.transitionRide(active.rideId, 'completed').then(() => navigation.navigate('EndRide', { summary, rideId: active.rideId })); }} /><CaptainActiveTabBar onHome={() => navigation.popToTop()} onBookings={() => navigation.navigate('CaptainBookings')} onSettings={() => navigation.navigate('Settings')} /></View></CaptainRideCancellationGuard>; }}</Stack.Screen>
    <Stack.Screen name="EndRide">{({ navigation, route }) => { const params = route.params as { summary: TripSummary; rideId: string }; return <EndRideScreen summary={params.summary} onBack={() => navigation.goBack()} onConfirmed={() => navigation.navigate('RateCustomer')} />; }}</Stack.Screen>
    <Stack.Screen name="RateCustomer">{({ navigation }) => <RateCustomerScreen onDone={() => { onTripComplete(); navigation.popToTop(); }} />}</Stack.Screen>
    <Stack.Screen name="IncomingRequest">{({ navigation }) => <IncomingRequestScreen onBack={() => navigation.goBack()} onDecline={() => navigation.goBack()} onAccept={() => navigation.replace('RideInProgress')} />}</Stack.Screen>
    <Stack.Screen name="RideInProgress">{({ navigation }) => <RideInProgressScreen onBack={() => navigation.navigate('CaptainHome')} onComplete={() => navigation.replace('RideSummary')} />}</Stack.Screen>
    <Stack.Screen name="RideSummary">{({ navigation }) => <RideSummaryScreen onHome={() => navigation.navigate('CaptainHome')} />}</Stack.Screen>
    <Stack.Screen name="Settings">{({ navigation }) => <SettingsScreen onBack={() => navigation.goBack()} onLanguageChange={(language) => { void onLanguageChange(language).then(() => navigation.goBack()); }} />}</Stack.Screen>
  </Stack.Navigator>;
}
