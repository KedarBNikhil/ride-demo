import React, { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AppLanguage } from '../i18n/createI18n';
import { IncomingRequestScreen, RideInProgressScreen, RideSummaryScreen } from '../screens/CaptainScreens';
import { CaptainDashboardScreen } from '../screens/captain/CaptainDashboardScreen';
import { ToPickupScreen } from '../screens/captain/ToPickupScreen';
import { StartRideScreen } from '../screens/captain/StartRideScreen';
import { TripInProgressScreen, type TripSummary } from '../screens/captain/TripInProgressScreen';
import { EndRideScreen } from '../screens/captain/EndRideScreen';
import { RateCustomerScreen } from '../screens/captain/RateCustomerScreen';
import type { CaptainRideRequest, DispatchRide } from '../services/rideDispatch';
import { rideDispatchService } from '../services/rideDispatch';
import { SettingsScreen } from '../screens/SettingsScreen';

const Stack = createNativeStackNavigator();
const cancellationMessage = (ride: DispatchRide) => `Reason: ${(ride.cancellation_reason_detail || ride.cancellation_reason_code || 'Customer cancelled').replace(/_/g, ' ')}${Number(ride.cancellation_charge ?? 0) > 0 ? `\nCancellation charge: ₹${Number(ride.cancellation_charge).toFixed(2)}` : ''}`;

function CaptainRideCancellationGuard({ rideId, onCancelled, children }: { rideId: string; onCancelled: (ride: DispatchRide) => void; children: React.ReactNode }) {
  useEffect(() => rideDispatchService.subscribeToRide(rideId, (ride) => { if (ride.status === 'cancelled') onCancelled(ride); }), [onCancelled, rideId]);
  return <>{children}</>;
}

export function CaptainMainStack({ online, onToggle, onLanguageChange, onTripComplete }: { online: boolean; onToggle: () => void; onLanguageChange: (language: AppLanguage) => Promise<void>; onTripComplete: () => void }) {
  const [request, setRequest] = useState<CaptainRideRequest | null>(null);
  const [requestCycle, setRequestCycle] = useState(0);
  const dismissRequest = useCallback(() => { setRequest(null); setRequestCycle((cycle) => cycle + 1); }, []);
  return <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 260 }}>
    <Stack.Screen name="CaptainHome">{({ navigation }) => <CaptainDashboardScreen online={online} onToggle={onToggle} onSettings={() => navigation.navigate('Settings')} onRequest={setRequest} request={request} requestCycle={requestCycle} onResumeRide={(ride) => { if (ride.status === 'accepted') navigation.navigate('ToPickup', { request: ride }); else if (ride.status === 'arrived') navigation.navigate('StartRide', { request: ride }); else navigation.navigate('TripInProgress', { request: ride }); }} onReject={() => { const active = request; dismissRequest(); if (active) void rideDispatchService.respondToOffer(active.offerId, false); }} onAccept={() => { const active = request; if (!active) return; void rideDispatchService.respondToOffer(active.offerId, true).then(() => { dismissRequest(); navigation.navigate('ToPickup', { request: active }); }); }} />}</Stack.Screen>
    <Stack.Screen name="ToPickup">{({ navigation, route }) => { const params = route.params as { request: CaptainRideRequest; arrived?: boolean }; const active = params.request; const cancelled = (ride: DispatchRide) => { Alert.alert('Ride cancelled', cancellationMessage(ride)); navigation.popToTop(); }; return <CaptainRideCancellationGuard rideId={active.rideId} onCancelled={cancelled}><ToPickupScreen request={active} arrived={params.arrived} onBack={() => navigation.goBack()} onPrimaryAction={() => { if (params.arrived) navigation.navigate('StartRide', { request: active }); else void rideDispatchService.transitionRide(active.rideId, 'arrived').then(() => navigation.navigate('StartRide', { request: active })); }} /></CaptainRideCancellationGuard>; }}</Stack.Screen>
    <Stack.Screen name="StartRide">{({ navigation, route }) => { const active = (route.params as { request: CaptainRideRequest }).request; const cancelled = (ride: DispatchRide) => { Alert.alert('Ride cancelled', cancellationMessage(ride)); navigation.popToTop(); }; return <CaptainRideCancellationGuard rideId={active.rideId} onCancelled={cancelled}><StartRideScreen onBack={() => navigation.replace('ToPickup', { request: active, arrived: true })} onVerified={async (otp) => { await rideDispatchService.startRide(active.rideId, otp); navigation.navigate('TripInProgress', { request: active }); }} /></CaptainRideCancellationGuard>; }}</Stack.Screen>
    <Stack.Screen name="TripInProgress">{({ navigation, route }) => { const active = (route.params as { request: CaptainRideRequest }).request; const cancelled = (ride: DispatchRide) => { Alert.alert('Ride cancelled', cancellationMessage(ride)); navigation.popToTop(); }; return <CaptainRideCancellationGuard rideId={active.rideId} onCancelled={cancelled}><TripInProgressScreen request={active} onBack={() => navigation.goBack()} onEndRide={(summary: TripSummary) => { void rideDispatchService.transitionRide(active.rideId, 'completed').then(() => navigation.navigate('EndRide', { summary, rideId: active.rideId })); }} /></CaptainRideCancellationGuard>; }}</Stack.Screen>
    <Stack.Screen name="EndRide">{({ navigation, route }) => { const params = route.params as { summary: TripSummary; rideId: string }; return <EndRideScreen summary={params.summary} onBack={() => navigation.goBack()} onConfirmed={() => navigation.navigate('RateCustomer')} />; }}</Stack.Screen>
    <Stack.Screen name="RateCustomer">{({ navigation }) => <RateCustomerScreen onDone={() => { onTripComplete(); navigation.popToTop(); }} />}</Stack.Screen>
    <Stack.Screen name="IncomingRequest">{({ navigation }) => <IncomingRequestScreen onBack={() => navigation.goBack()} onDecline={() => navigation.goBack()} onAccept={() => navigation.replace('RideInProgress')} />}</Stack.Screen>
    <Stack.Screen name="RideInProgress">{({ navigation }) => <RideInProgressScreen onBack={() => navigation.navigate('CaptainHome')} onComplete={() => navigation.replace('RideSummary')} />}</Stack.Screen>
    <Stack.Screen name="RideSummary">{({ navigation }) => <RideSummaryScreen onHome={() => navigation.navigate('CaptainHome')} />}</Stack.Screen>
    <Stack.Screen name="Settings">{({ navigation }) => <SettingsScreen onBack={() => navigation.goBack()} onLanguageChange={(language) => { void onLanguageChange(language).then(() => navigation.goBack()); }} />}</Stack.Screen>
  </Stack.Navigator>;
}
