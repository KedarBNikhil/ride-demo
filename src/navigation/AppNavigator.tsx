import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createAppI18n, type AppLanguage } from '../i18n/createI18n';
import { LanguageSelectScreen } from '../screens/LanguageSelectScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { EmergencyContactsScreen } from '../screens/EmergencyContactsScreen';
import { DialogProvider } from '../components/ThemedDialog';
import { BookingConfirmScreen, CustomerAuthChoiceScreen, CustomerBookingsScreen, CustomerHomeScreen, CustomerIntroScreen, CustomerLoginScreen, CustomerSignupScreen, type CustomerRide, LocationPickerScreen, RideConfirmedScreen, RideTypeScreen, SearchingScreen } from '../screens/CustomerScreens';
import { CustomerRideChat } from '../components/CustomerRideChat';
import { CaptainOnboardingStack } from './CaptainOnboardingStack';
import { CaptainMainStack } from './CaptainMainStack';
import type { CaptainProfile } from '../services/captainOnboarding';
import { captainOnboardingService } from '../services/captainOnboarding';
import { rideDispatchService, type DispatchRide, type RideStatus } from '../services/rideDispatch';
import { subscribeToCustomerRideNotificationResponses } from '../services/pushNotifications';
import { OperatorReconciliationScreen } from '../screens/OperatorReconciliationScreen';

export type AppMode = 'customer' | 'captain' | 'operator';
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();
const CAPTAIN_ONBOARDING_FLOW_VERSION = '3';
const captainOnboardingCompleteKey = 'nandyal-ride-demo.captain.onboardingComplete';
const captainOnboardingSubmittedKey = 'nandyal-ride-demo.captain.onboardingSubmitted';
const captainOnboardingVersionKey = 'nandyal-ride-demo.captain.onboardingFlowVersion';

export function AppNavigator({ mode, onExit }: { mode: AppMode; onExit: () => void }) {
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasLanguage, setHasLanguage] = useState<boolean | null>(null);
  const [i18n] = useState(() => createAppI18n('en'));
  const [customerRide, setCustomerRide] = useState<CustomerRide>({ pickup: '', drop: '', kind: 'bike', passengerCount: 1 });
  const [customerRideStatus, setCustomerRideStatus] = useState<RideStatus | null>(null);
  const [searchUnavailableMessage, setSearchUnavailableMessage] = useState(false);
  const [locationTarget, setLocationTarget] = useState<'pickup' | 'drop'>('pickup');
  const [captainOnline, setCaptainOnline] = useState(false);
  const [captainProfile, setCaptainProfile] = useState<CaptainProfile>({ name: '', language: 'en', vehicleType: null });
  const [captainOnboardingComplete, setCaptainOnboardingComplete] = useState<boolean | null>(mode === 'captain' ? null : false);
  const [captainOnboardingSubmitted, setCaptainOnboardingSubmitted] = useState<boolean | null>(mode === 'captain' ? null : false);
  const storageKey = `nandyal-ride-demo.${mode}.language`;

  const customerRideFromDispatch = (ride: DispatchRide): CustomerRide => ({
    id: ride.id, kind: ride.ride_type, passengerCount: ride.ride_type === 'auto' ? Number(ride.passenger_count ?? 1) : 1, pickup: ride.pickup_address, drop: ride.drop_address,
    ...(ride.pickup_latitude != null && ride.pickup_longitude != null ? { pickupCoordinate: { latitude: Number(ride.pickup_latitude), longitude: Number(ride.pickup_longitude) } } : {}),
    ...(ride.drop_latitude != null && ride.drop_longitude != null ? { dropCoordinate: { latitude: Number(ride.drop_latitude), longitude: Number(ride.drop_longitude) } } : {}),
  });
  const clearCustomerRide = useCallback(() => {
    setCustomerRideStatus('cancelled');
    setCustomerRide(({ id: _id, routeQuote: _routeQuote, ...currentRide }) => currentRide);
  }, []);
  const hideSearchUnavailableMessage = useCallback(() => setSearchUnavailableMessage(false), []);

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (saved === 'en' || saved === 'te') { setLanguage(saved); i18n.changeLanguage(saved); setHasLanguage(true); }
      else setHasLanguage(false);
    });
  }, [i18n, storageKey]);

  useEffect(() => {
    if (mode !== 'captain') return;
    void (async () => {
      try {
        const status = await captainOnboardingService.getReviewStatus();
        setCaptainOnboardingComplete(status === 'approved');
        setCaptainOnboardingSubmitted(status === 'submitted');
      } catch {
        setCaptainOnboardingComplete(false);
        setCaptainOnboardingSubmitted(false);
      }
    })();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'captain' || !captainOnboardingComplete) return;
    void rideDispatchService.getCaptainAvailability().then(setCaptainOnline).catch(() => setCaptainOnline(false));
  }, [captainOnboardingComplete, mode]);

  useEffect(() => {
    if (mode !== 'customer') return;
    return subscribeToCustomerRideNotificationResponses(({ rideId }) => {
      void rideDispatchService.getRide(rideId).then((ride) => {
        if (ride.status === 'cancelled' && ride.fare_approval_status === 'declined' && ride.cancellation_reason_detail === 'Customer did not confirm updated captain-distance fare within 30 seconds') {
          clearCustomerRide();
          if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: 'RideType' as never }] });
          return;
        }
        setCustomerRide(customerRideFromDispatch(ride));
        setCustomerRideStatus(ride.status);
        if (!navigationRef.isReady()) return;
        if (ride.status === 'requested' || ride.status === 'searching') navigationRef.reset({ index: 0, routes: [{ name: 'Searching' as never }] });
        else if (ride.status === 'cancelled') navigationRef.reset({ index: 0, routes: [{ name: 'CustomerBookings' as never }] });
        else navigationRef.reset({ index: 0, routes: [{ name: 'RideConfirmed' as never }] });
      }).catch(() => undefined);
    });
  }, [clearCustomerRide, mode]);

  useEffect(() => {
    if (mode !== 'customer') return;
    const reconcileActiveRide = () => {
      void rideDispatchService.getCustomerActiveRide().then((ride) => {
        if (!ride) {
          if (customerRide.id) {
            clearCustomerRide();
            if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: 'RideType' as never }] });
          }
          return;
        }
        setCustomerRide(customerRideFromDispatch(ride));
        setCustomerRideStatus(ride.status);
        if (!navigationRef.isReady()) return;
        if (ride.status === 'requested' || ride.status === 'searching') navigationRef.reset({ index: 0, routes: [{ name: 'Searching' as never }] });
        else navigationRef.reset({ index: 0, routes: [{ name: 'RideConfirmed' as never }] });
      }).catch(() => undefined);
    };
    reconcileActiveRide();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') reconcileActiveRide();
    });
    return () => subscription.remove();
  }, [clearCustomerRide, customerRide.id, mode]);

  useEffect(() => {
    if (mode !== 'customer' || !customerRide.id || customerRide.id.startsWith('local-')) return;
    return rideDispatchService.subscribeToRide(customerRide.id, (ride) => {
      if (ride.status === 'cancelled' && ride.fare_approval_status === 'declined' && ride.cancellation_reason_detail === 'Customer did not confirm updated captain-distance fare within 30 seconds') {
        clearCustomerRide();
        if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: 'RideType' as never }] });
        return;
      }
      setCustomerRideStatus(ride.status);
    });
  }, [clearCustomerRide, customerRide.id, mode]);

  const chooseLanguage = async (next: AppLanguage) => {
    setLanguage(next);
    await i18n.changeLanguage(next);
    await AsyncStorage.setItem(storageKey, next);
    setHasLanguage(true);
  };

  const submitCaptainOnboarding = async () => { setCaptainOnboardingSubmitted(true); };
  const completeCaptainOnboarding = async () => { setCaptainOnboardingSubmitted(false); setCaptainOnboardingComplete(true); };
  if (hasLanguage === null || (mode === 'captain' && (captainOnboardingComplete === null || captainOnboardingSubmitted === null))) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  return <I18nextProvider i18n={i18n}>
    <DialogProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: Platform.OS === 'ios' ? 'slide_from_right' : 'slide_from_right', animationDuration: 260 }}>
        {!hasLanguage && mode !== 'customer' && <Stack.Screen name="LanguageSelect">{() => <LanguageSelectScreen onChoose={chooseLanguage} />}</Stack.Screen>}
        {mode === 'customer' ? <>
          <Stack.Screen name="CustomerIntro" options={{ animation: 'fade' }}>{({ navigation }) => <CustomerIntroScreen onComplete={() => navigation.replace('CustomerAuthChoice')} />}</Stack.Screen>
          <Stack.Screen name="CustomerAuthChoice">{({ navigation }) => <CustomerAuthChoiceScreen onLogin={() => navigation.navigate('CustomerLogin')} onSignup={() => navigation.navigate('CustomerSignup')} />}</Stack.Screen>
          <Stack.Screen name="CustomerLogin">{({ navigation }) => <CustomerLoginScreen onBack={() => navigation.goBack()} onComplete={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
          <Stack.Screen name="CustomerSignup">{({ navigation }) => <CustomerSignupScreen onBack={() => navigation.goBack()} onComplete={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
          <Stack.Screen name="CustomerHome">{({ navigation }) => <CustomerHomeScreen ride={customerRide} hasActiveRide={customerRideStatus === 'requested' || customerRideStatus === 'searching' || customerRideStatus === 'accepted' || customerRideStatus === 'arrived' || customerRideStatus === 'in_progress'} onBack={onExit} onProfile={() => navigation.navigate('Settings', { profile: true })} onBookings={() => navigation.navigate('CustomerBookings')} onPickLocation={(target) => { setLocationTarget(target); navigation.navigate('LocationPicker'); }} onStartBooking={(pickup, pickupCoordinate) => { setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate, routeQuote: undefined })); setLocationTarget('drop'); navigation.navigate('LocationPicker'); }} onPickupHere={(pickup, pickupCoordinate) => { setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate, routeQuote: undefined })); setLocationTarget('pickup'); navigation.navigate('LocationPicker'); }} />}</Stack.Screen>
          <Stack.Screen name="LocationPicker">{({ navigation }) => <LocationPickerScreen ride={customerRide} initialTarget={locationTarget} onBack={() => navigation.goBack()} onChange={(target, place, coordinate) => setCustomerRide((ride) => ({ ...ride, [target]: place, routeQuote: undefined, [target === 'pickup' ? 'pickupCoordinate' : 'dropCoordinate']: coordinate }))} onContinue={() => navigation.navigate('RideType')} />}</Stack.Screen>
          <Stack.Screen name="RideType">{({ navigation }) => <RideTypeScreen ride={customerRide} selected={customerRide.kind} onBack={() => { if (navigation.canGoBack()) navigation.goBack(); else navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onEditLocation={(target) => { setLocationTarget(target); navigation.navigate('LocationPicker'); }} onSelect={(kind) => setCustomerRide((ride) => ({ ...ride, kind, passengerCount: kind === 'bike' ? 1 : ride.passengerCount }))} onPassengerCountChange={(passengerCount) => setCustomerRide((ride) => ({ ...ride, passengerCount }))} onRouteQuote={(routeQuote) => setCustomerRide((ride) => ({ ...ride, routeQuote }))} onNext={() => navigation.navigate('BookingConfirm')} unavailableMessage={searchUnavailableMessage ? 'No captains available at the moment. Please try again' : undefined} onUnavailableMessageHidden={hideSearchUnavailableMessage} />}</Stack.Screen>
          <Stack.Screen name="BookingConfirm">{({ navigation }) => <BookingConfirmScreen ride={customerRide} onBack={() => navigation.goBack()} onBook={async (rideId) => { setCustomerRide((ride) => ({ ...ride, id: rideId })); setCustomerRideStatus('searching'); navigation.navigate('Searching'); }} />}</Stack.Screen>
          <Stack.Screen name="Searching" options={{ animation: 'fade' }}>{({ navigation }) => <SearchingScreen rideId={customerRide.id} onBack={() => navigation.goBack()} onFound={() => navigation.replace('RideConfirmed')} onUnavailable={() => { clearCustomerRide(); setSearchUnavailableMessage(true); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onCancel={() => { setCustomerRideStatus('cancelled'); setCustomerRide((ride) => ({ ...ride, routeQuote: undefined })); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onHome={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} onBookings={() => navigation.navigate('CustomerBookings')} onProfile={() => navigation.navigate('Settings', { profile: true })} />}</Stack.Screen>
          <Stack.Screen name="RideConfirmed" options={{ animation: 'fade' }}>{({ navigation }) => <RideConfirmedScreen ride={customerRide} onHome={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} onCancelled={() => { setCustomerRideStatus('cancelled'); setCustomerRide((ride) => ({ ...ride, routeQuote: undefined })); navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onFareQuoteCancelled={() => { clearCustomerRide(); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onBookings={() => navigation.navigate('CustomerBookings')} onProfile={() => navigation.navigate('Settings', { profile: true })} onOpenChat={(rideId, captainName) => navigation.navigate('CustomerRideChat', { rideId, captainName })} />}</Stack.Screen>
          <Stack.Screen name="CustomerRideChat">{({ navigation, route }) => { const { rideId, captainName } = route.params as { rideId: string; captainName: string }; return <CustomerRideChat rideId={rideId} captainName={captainName} onBack={() => navigation.goBack()} />; }}</Stack.Screen>
          <Stack.Screen name="CustomerBookings">{({ navigation }) => <CustomerBookingsScreen ride={customerRide} onHome={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} onProfile={() => navigation.navigate('Settings', { profile: true })} onCancelled={() => { setCustomerRideStatus('cancelled'); navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onOpenRide={(selectedRide, status) => { setCustomerRide(selectedRide); setCustomerRideStatus(status); if (status === 'cancelled' || status === 'completed') { setLocationTarget('pickup'); navigation.navigate('LocationPicker'); } else if (status === 'requested' || status === 'searching') navigation.navigate('Searching'); else navigation.navigate('RideConfirmed'); }} />}</Stack.Screen>
        </> : mode === 'captain' ? <>
          {captainOnboardingComplete ? <Stack.Screen name="CaptainMain">{() => <CaptainMainStack online={captainOnline} onToggle={() => setCaptainOnline((online) => !online)} onLanguageChange={chooseLanguage} onTripComplete={() => setCaptainOnline(true)} />}</Stack.Screen> : <Stack.Screen name="CaptainOnboarding">{() => <CaptainOnboardingStack language={language} onLanguageChange={chooseLanguage} profile={captainProfile} onProfileChange={setCaptainProfile} onExit={onExit} submitted={Boolean(captainOnboardingSubmitted)} onSubmitted={submitCaptainOnboarding} onApproved={completeCaptainOnboarding} />}</Stack.Screen>}
        </> : mode === 'operator' ? <>
          <Stack.Screen name="OperatorLogin">{({ navigation }) => <CustomerLoginScreen onComplete={() => navigation.replace('OperatorReconciliation')} onBack={onExit} />}</Stack.Screen>
          <Stack.Screen name="OperatorReconciliation">{() => <OperatorReconciliationScreen onExit={onExit} />}</Stack.Screen>
        </> : null}
        <Stack.Screen name="Settings">{({ navigation, route }) => <SettingsScreen profile={Boolean((route.params as { profile?: boolean } | undefined)?.profile)} ratingRole={mode === 'customer' ? 'customer' : undefined} onBack={() => navigation.goBack()} onLanguageChange={(next) => { chooseLanguage(next).then(() => navigation.goBack()); }} onSafety={mode === 'customer' ? () => navigation.navigate('EmergencyContacts') : undefined} />}</Stack.Screen>
        <Stack.Screen name="EmergencyContacts">{({ navigation }) => <EmergencyContactsScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
    </GestureHandlerRootView>
    </DialogProvider>
  </I18nextProvider>;
}
