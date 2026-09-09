import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createAppI18n, type AppLanguage } from '../i18n/createI18n';
import { LanguageSelectScreen } from '../screens/LanguageSelectScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { CustomerProfileScreen } from '../screens/CustomerProfileScreen';
import { EmergencyContactsScreen } from '../screens/EmergencyContactsScreen';
import { LiveRideShareScreen } from '../screens/LiveRideShareScreen';
import { LiveRideTrackingScreen } from '../screens/LiveRideTrackingScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { DialogProvider } from '../components/ThemedDialog';
import { BookingConfirmScreen, CustomerAuthChoiceScreen, CustomerBookingsScreen, CustomerHomeScreen, CustomerIntroScreen, CustomerLoginScreen, CustomerOffersScreen, CustomerSignupScreen, type CustomerRide, LocationPickerScreen, RideConfirmedScreen, RideTypeScreen, SearchingScreen } from '../screens/CustomerScreens';
import { CustomerRideChat } from '../components/CustomerRideChat';
import { CustomerPaymentIssueSupportScreen } from '../screens/CustomerPaymentIssueSupportScreen';
import { CaptainOnboardingStack } from './CaptainOnboardingStack';
import { CaptainMainStack } from './CaptainMainStack';
import type { CaptainAccountStatus, CaptainOnboardingRoute, CaptainProfile } from '../services/captainOnboarding';
import { captainOnboardingService } from '../services/captainOnboarding';
import { customerRideLifecycle, isCustomerActiveRideStatus, rideDispatchService, type DispatchRide, type RideStatus } from '../services/rideDispatch';
import { configurePushNotifications, registerPushNotifications, subscribeToCustomerRideNotificationResponses } from '../services/pushNotifications';
import { OperatorReconciliationScreen } from '../screens/OperatorReconciliationScreen';
import { supabase } from '../lib/supabase';

export type AppMode = 'customer' | 'captain' | 'operator';
const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();
const currentRouteName = () => (navigationRef.getCurrentRoute() as { name?: string } | undefined)?.name;
const customerBookingRouteNames = new Set(['CustomerHome', 'LocationPicker', 'RideType', 'BookingConfirm', 'CustomerOffers']);
type CustomerRideResolution = 'resolving' | 'active' | 'none';
export function AppNavigator({ mode, onExit }: { mode: AppMode; onExit: () => void }) {
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasLanguage, setHasLanguage] = useState<boolean | null>(null);
  const [i18n] = useState(() => createAppI18n('en'));
  const [customerRide, setCustomerRide] = useState<CustomerRide>({ pickup: '', drop: '', kind: 'bike', passengerCount: 1 });
  const [customerRideStatus, setCustomerRideStatus] = useState<RideStatus | null>(null);
  const [customerRideResolution, setCustomerRideResolution] = useState<CustomerRideResolution>(mode === 'customer' ? 'resolving' : 'none');
  const [searchUnavailableMessage, setSearchUnavailableMessage] = useState(false);
  const [locationTarget, setLocationTarget] = useState<'pickup' | 'drop'>('pickup');
  const [captainOnline, setCaptainOnline] = useState(false);
  const [captainProfile, setCaptainProfile] = useState<CaptainProfile>({ name: '', language: 'en', vehicleType: null });
  const [captainAccountStatus, setCaptainAccountStatus] = useState<CaptainAccountStatus>(mode === 'captain' ? 'unauthenticated' : 'new');
  const [captainOnboardingRoute, setCaptainOnboardingRoute] = useState<CaptainOnboardingRoute>('signup');
  const [captainAccountReady, setCaptainAccountReady] = useState(mode !== 'captain');
  const [customerSessionReady, setCustomerSessionReady] = useState(mode !== 'customer');
  const [hasCustomerSession, setHasCustomerSession] = useState(false);
  const customerRideRef = useRef(customerRide);
  const activeRideSyncRef = useRef<Promise<DispatchRide | null> | null>(null);
  const customerRideSyncPendingRef = useRef(false);
  const reconcileCustomerRideRef = useRef<() => Promise<DispatchRide | null>>(async () => null);
  const activeRideRedirectRef = useRef<string | null>(null);
  const storageKey = `nandyal-ride-demo.${mode}.language`;

  useEffect(() => {
    configurePushNotifications();
  }, []);

  // A development build can restore an existing authenticated session without
  // revisiting the OTP screen. Register here so every authenticated launch
  // refreshes the device token for background delivery in either app variant.
  useEffect(() => {
    if ((mode !== 'customer' && mode !== 'captain') || !supabase) return;
    let mounted = true;
    const register = (hasSession: boolean) => {
      if (!mounted || !hasSession) return;
      void registerPushNotifications(mode).catch((error) => {
        console.warn('[push] device registration failed', error);
      });
    };

    void supabase.auth.getSession().then(({ data: { session } }) => register(Boolean(session)));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => register(Boolean(session)));
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [mode]);

  const customerRideFromDispatch = (ride: DispatchRide): CustomerRide => ({
    id: ride.id, kind: ride.ride_type, passengerCount: ride.ride_type === 'auto' ? Number(ride.passenger_count ?? 1) : 1, pickup: ride.pickup_address, drop: ride.drop_address,
    ...(ride.pickup_latitude != null && ride.pickup_longitude != null ? { pickupCoordinate: { latitude: Number(ride.pickup_latitude), longitude: Number(ride.pickup_longitude) } } : {}),
    ...(ride.drop_latitude != null && ride.drop_longitude != null ? { dropCoordinate: { latitude: Number(ride.drop_latitude), longitude: Number(ride.drop_longitude) } } : {}),
  });
  useEffect(() => { customerRideRef.current = customerRide; }, [customerRide]);
  const clearCustomerRide = useCallback(() => {
    setCustomerRideStatus('cancelled');
    // A completed ride's route must never become an implicit next booking.
    setCustomerRide({ pickup: '', drop: '', kind: 'bike', passengerCount: 1 });
  }, []);
  const hideSearchUnavailableMessage = useCallback(() => setSearchUnavailableMessage(false), []);

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (saved === 'en' || saved === 'te') { setLanguage(saved); i18n.changeLanguage(saved); setHasLanguage(true); }
      else setHasLanguage(false);
    });
  }, [i18n, storageKey]);

  // Do not send an already signed-in customer through the OTP flow again on
  // launch. Supabase restores the persisted session from AsyncStorage here.
  useEffect(() => {
    if (mode !== 'customer') return;
    if (!supabase) {
      setHasCustomerSession(false);
      setCustomerSessionReady(true);
      return;
    }

    let mounted = true;
    const applySession = (session: unknown) => {
      if (!mounted) return;
      setHasCustomerSession(Boolean(session));
      setCustomerRideResolution(session ? 'resolving' : 'none');
      setCustomerSessionReady(true);
    };

    void supabase.auth.getSession()
      .then(({ data: { session } }) => applySession(session))
      .catch(() => applySession(null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [mode]);

  const resolveCaptainAccount = useCallback(async () => {
    if (mode !== 'captain') return;
    setCaptainAccountReady(false);
    const account = await captainOnboardingService.resolveAuthenticatedAccount();
    setCaptainProfile(account.profile);
    setCaptainAccountStatus(account.status);
    setCaptainOnboardingRoute(account.onboardingRoute);
    setCaptainAccountReady(true);
  }, [mode]);

  // Cold launch and immediate post-OTP login deliberately share this backend
  // resolver. Do not infer Captain state from the previous screen or storage.
  useEffect(() => {
    if (mode !== 'captain') return;
    let mounted = true;
    const apply = async () => {
      try {
        const account = await captainOnboardingService.resolveAuthenticatedAccount();
        if (!mounted) return;
        setCaptainProfile(account.profile);
        setCaptainAccountStatus(account.status);
        setCaptainOnboardingRoute(account.onboardingRoute);
      } catch {
        if (mounted) setCaptainAccountStatus('unauthenticated');
      } finally {
        if (mounted) setCaptainAccountReady(true);
      }
    };
    void apply();
    if (!supabase) return () => { mounted = false; };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (!session || event === 'SIGNED_OUT') {
        setCaptainAccountStatus('unauthenticated');
        setCaptainOnboardingRoute('signup');
        setCaptainAccountReady(true);
        return;
      }
      setCaptainAccountReady(false);
      void apply();
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'captain' || captainAccountStatus !== 'approved') return;
    void rideDispatchService.getCaptainAvailability().then(setCaptainOnline).catch(() => setCaptainOnline(false));
  }, [captainAccountStatus, mode]);

  useEffect(() => {
    if (mode !== 'customer') return;
    return subscribeToCustomerRideNotificationResponses(({ rideId }) => {
      void rideDispatchService.getRide(rideId).then((ride) => {
        if (ride.status === 'cancelled' && ride.fare_approval_status === 'declined' && ride.cancellation_reason_detail === 'Customer did not confirm updated captain-distance fare within 30 seconds') {
          clearCustomerRide();
          if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: 'RideType' as never }] });
          return;
        }
        // The notification only identifies an RLS-authorized ride. Route from
        // the current backend lifecycle, never from notification text/state.
        void reconcileCustomerRideRef.current().then((currentRide) => {
          if (currentRide || !navigationRef.isReady()) return;
          if (ride.status === 'cancelled') navigationRef.reset({ index: 0, routes: [{ name: 'CustomerBookings' as never }] });
        }).catch(() => undefined);
      }).catch(() => undefined);
    });
  }, [clearCustomerRide, mode]);

  const openCurrentCustomerRide = useCallback((ride: DispatchRide) => {
    if (!navigationRef.isReady()) return;
    const target = ride.status === 'requested' || ride.status === 'searching' ? 'Searching' : 'RideConfirmed';
    const redirectKey = `${ride.id}:${target}`;
    if (currentRouteName() === target || activeRideRedirectRef.current === redirectKey) return;
    activeRideRedirectRef.current = redirectKey;
    navigationRef.reset({ index: 0, routes: [{ name: target as never }] });
    activeRideRedirectRef.current = null;
  }, []);

  const reconcileCurrentCustomerRide = useCallback(async (): Promise<DispatchRide | null> => {
    if (mode !== 'customer' || !customerSessionReady || !hasCustomerSession) return null;
    if (activeRideSyncRef.current) {
      // Realtime, notification, focus, and navigation may all arrive while a
      // history read is in flight. Queue one fresh authoritative read rather
      // than letting the older result win the route.
      customerRideSyncPendingRef.current = true;
      return activeRideSyncRef.current;
    }
    setCustomerRideResolution('resolving');
    const sync = (async () => {
      // The same backend query is used on launch, resume, navigation changes,
      // and every booking attempt. Local navigation state is never authority.
      const ride = await rideDispatchService.getCustomerCurrentRide();
      if (!ride) {
        setCustomerRideResolution('none');
        if (customerRideRef.current.id && !customerRideRef.current.id.startsWith('local-')) clearCustomerRide();
        return null;
      }
      const pickupOtp = ride.status === 'arrived' ? await rideDispatchService.getStoredCustomerPickupOtp(ride.id) : null;
      setCustomerRide({ ...customerRideFromDispatch(ride), ...(pickupOtp ? { pickupOtp } : {}) });
      setCustomerRideStatus(ride.status);
      setCustomerRideResolution('active');
      if (ride.status === 'arrived' && !pickupOtp) {
        void rideDispatchService.issueCustomerPickupOtp(ride.id).then((otp) => {
          if (otp) setCustomerRide((current) => current.id === ride.id ? { ...current, pickupOtp: otp } : current);
        }).catch(() => undefined);
      }
      if (__DEV__) console.info('[customer-ride-lifecycle] resolved', { rideId: ride.id, lifecycle: customerRideLifecycle(ride), status: ride.status, paymentStatus: ride.payment_status ?? null });
      openCurrentCustomerRide(ride);
      return ride;
    })();
    activeRideSyncRef.current = sync;
    try {
      return await sync;
    } finally {
      activeRideSyncRef.current = null;
      if (customerRideSyncPendingRef.current) {
        customerRideSyncPendingRef.current = false;
        void reconcileCurrentCustomerRide().catch(() => undefined);
      }
    }
  }, [clearCustomerRide, customerSessionReady, hasCustomerSession, mode, openCurrentCustomerRide]);
  reconcileCustomerRideRef.current = reconcileCurrentCustomerRide;

  const allowCustomerBooking = useCallback(async () => {
    try {
      const currentRide = await reconcileCurrentCustomerRide();
      if (!currentRide) return true;
      if (__DEV__) console.info('[customer-booking] blocked-current-ride', { rideId: currentRide.id, lifecycle: customerRideLifecycle(currentRide), status: currentRide.status });
      openCurrentCustomerRide(currentRide);
    } catch {
      // A transient resolver failure is not evidence that booking is safe.
      if (__DEV__) console.warn('[customer-booking] blocked-active-ride-resolution-failed');
    }
    return false;
  }, [openCurrentCustomerRide, reconcileCurrentCustomerRide]);

  const openCustomerHome = useCallback(() => {
    void reconcileCurrentCustomerRide().then((currentRide) => {
      if (currentRide) return;
      if (navigationRef.isReady() && currentRouteName() !== 'CustomerHome') navigationRef.reset({ index: 0, routes: [{ name: 'CustomerHome' as never }] });
    }).catch(() => undefined);
  }, [reconcileCurrentCustomerRide]);

  useEffect(() => {
    if (mode !== 'customer') return;
    void reconcileCurrentCustomerRide().catch(() => undefined);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void reconcileCurrentCustomerRide().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [mode, reconcileCurrentCustomerRide]);

  useEffect(() => {
    if (mode !== 'customer' || !customerRide.id || customerRide.id.startsWith('local-')) return;
    return rideDispatchService.subscribeToRide(customerRide.id, (ride) => {
      if (ride.status === 'cancelled' && ride.fare_approval_status === 'declined' && ride.cancellation_reason_detail === 'Customer did not confirm updated captain-distance fare within 30 seconds') {
        clearCustomerRide();
        if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: 'RideType' as never }] });
        return;
      }
      setCustomerRideStatus(ride.status);
      void reconcileCurrentCustomerRide().catch(() => undefined);
    });
  }, [clearCustomerRide, customerRide.id, mode, reconcileCurrentCustomerRide]);

  const chooseLanguage = async (next: AppLanguage) => {
    setLanguage(next);
    await i18n.changeLanguage(next);
    await AsyncStorage.setItem(storageKey, next);
    setHasLanguage(true);
  };

  const submitCaptainOnboarding = async () => { setCaptainOnboardingRoute('review'); setCaptainAccountStatus('submitted'); };
  const completeCaptainOnboarding = async () => { await resolveCaptainAccount(); };
  const completeCaptainOtp = async () => {
    setCaptainAccountReady(false);
    try {
      await resolveCaptainAccount();
    } catch (error) {
      setCaptainAccountStatus('unauthenticated');
      setCaptainOnboardingRoute('signup');
      setCaptainAccountReady(true);
      throw error;
    }
  };
  if (hasLanguage === null || !customerSessionReady || (mode === 'captain' && !captainAccountReady)) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  return <I18nextProvider i18n={i18n}>
    <DialogProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <NavigationContainer ref={navigationRef} linking={{ prefixes: ['exp+nandyal-ride-customer://'], config: { screens: { LiveRideTracking: 'live-ride/:token' } } }} onReady={() => { if (mode === 'customer') void reconcileCurrentCustomerRide().catch(() => undefined); }} onStateChange={() => {
      if (mode !== 'customer' || !customerBookingRouteNames.has(currentRouteName() ?? '')) return;
      void reconcileCurrentCustomerRide().catch(() => undefined);
    }}>
      <Stack.Navigator key={mode === 'captain' ? `captain-${captainAccountStatus}` : mode} initialRouteName={mode === 'customer' ? 'CustomerIntro' : undefined} screenOptions={{ headerShown: false, animation: Platform.OS === 'ios' ? 'slide_from_right' : 'slide_from_right', animationDuration: 260 }}>
        {!hasLanguage && mode !== 'customer' && <Stack.Screen name="LanguageSelect">{() => <LanguageSelectScreen onChoose={chooseLanguage} />}</Stack.Screen>}
        {mode === 'customer' ? <>
          <Stack.Screen name="CustomerIntro" options={{ animation: 'fade' }}>{({ navigation }) => <CustomerIntroScreen onComplete={() => navigation.replace(hasCustomerSession ? 'CustomerHome' : 'CustomerAuthChoice')} />}</Stack.Screen>
          <Stack.Screen name="CustomerAuthChoice">{({ navigation }) => <CustomerAuthChoiceScreen onLogin={() => navigation.navigate('CustomerLogin')} onSignup={() => navigation.navigate('CustomerSignup')} />}</Stack.Screen>
          <Stack.Screen name="CustomerLogin">{({ navigation }) => <CustomerLoginScreen onBack={() => navigation.goBack()} onComplete={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
          <Stack.Screen name="CustomerSignup">{({ navigation }) => <CustomerSignupScreen onBack={() => navigation.goBack()} onComplete={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
          <Stack.Screen name="CustomerHome">{({ navigation }) => <CustomerHomeScreen ride={customerRide} hasActiveRide={customerRideResolution !== 'none' || isCustomerActiveRideStatus(customerRideStatus)} onBack={onExit} onProfile={() => navigation.navigate('CustomerProfile')} onBookings={() => navigation.navigate('CustomerBookings')} onPickLocation={(target) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; setLocationTarget(target); navigation.navigate('LocationPicker'); }); }} onChooseDestination={(drop, dropCoordinate, pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; setCustomerRide((ride) => ({ ...ride, pickup: pickup ?? ride.pickup, pickupCoordinate: pickupCoordinate ?? ride.pickupCoordinate, drop, dropCoordinate, routeQuote: undefined })); setLocationTarget('drop'); navigation.navigate('LocationPicker'); }); }} onStartBooking={(pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate, routeQuote: undefined })); setLocationTarget('drop'); navigation.navigate('LocationPicker'); }); }} onPickupHere={(pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate, routeQuote: undefined })); setLocationTarget('pickup'); navigation.navigate('LocationPicker'); }); }} />}</Stack.Screen>
          <Stack.Screen name="LocationPicker">{({ navigation }) => <LocationPickerScreen ride={customerRide} initialTarget={locationTarget} onBack={() => navigation.goBack()} onChange={(target, place, coordinate) => setCustomerRide((ride) => ({ ...ride, [target]: place, routeQuote: undefined, [target === 'pickup' ? 'pickupCoordinate' : 'dropCoordinate']: coordinate }))} onContinue={() => { void allowCustomerBooking().then((allowed) => { if (allowed) navigation.navigate('RideType'); }); }} />}</Stack.Screen>
          <Stack.Screen name="RideType">{({ navigation }) => <RideTypeScreen ride={customerRide} selected={customerRide.kind} onBack={() => { if (navigation.canGoBack()) navigation.goBack(); else openCustomerHome(); }} onEditLocation={(target) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; setLocationTarget(target); navigation.navigate('LocationPicker'); }); }} onSelect={(kind) => setCustomerRide((ride) => ({ ...ride, kind, passengerCount: kind === 'bike' ? 1 : ride.passengerCount }))} onPassengerCountChange={(passengerCount) => setCustomerRide((ride) => ({ ...ride, passengerCount }))} onRouteQuote={(routeQuote) => setCustomerRide((ride) => ({ ...ride, routeQuote }))} onOffers={() => navigation.navigate('CustomerOffers')} onNext={() => { void allowCustomerBooking().then((allowed) => { if (allowed) navigation.navigate('BookingConfirm'); }); }} unavailableMessage={searchUnavailableMessage ? 'No captains available at the moment. Please try again' : undefined} onUnavailableMessageHidden={hideSearchUnavailableMessage} />}</Stack.Screen>
          <Stack.Screen name="CustomerOffers">{({ navigation }) => <CustomerOffersScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
          <Stack.Screen name="BookingConfirm">{({ navigation }) => <BookingConfirmScreen ride={customerRide} onBack={() => navigation.goBack()} beforeBook={allowCustomerBooking} onBook={async (rideId) => { setCustomerRide((ride) => ({ ...ride, id: rideId, pickupOtp: undefined })); setCustomerRideStatus('searching'); setCustomerRideResolution('active'); navigation.navigate('Searching'); }} />}</Stack.Screen>
          <Stack.Screen name="Searching" options={{ animation: 'fade' }}>{({ navigation }) => <SearchingScreen rideId={customerRide.id} rideKind={customerRide.kind} pickupCoordinate={customerRide.pickupCoordinate} onBack={() => navigation.goBack()} onFound={() => navigation.replace('RideConfirmed')} onUnavailable={() => { clearCustomerRide(); setCustomerRideResolution('none'); setSearchUnavailableMessage(true); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onCancel={() => { setCustomerRideStatus('cancelled'); setCustomerRideResolution('none'); setCustomerRide((ride) => ({ ...ride, routeQuote: undefined, pickupOtp: undefined })); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onHome={openCustomerHome} onBookings={() => navigation.navigate('CustomerBookings')} onProfile={() => navigation.navigate('CustomerProfile')} />}</Stack.Screen>
          <Stack.Screen name="RideConfirmed" options={{ animation: 'fade' }}>{({ navigation }) => <RideConfirmedScreen ride={customerRide} onHome={openCustomerHome} onCancelled={() => { setCustomerRideStatus('cancelled'); setCustomerRideResolution('none'); setCustomerRide((ride) => ({ ...ride, routeQuote: undefined, pickupOtp: undefined })); navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onFareQuoteCancelled={() => { clearCustomerRide(); setCustomerRideResolution('none'); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onBookings={() => navigation.navigate('CustomerBookings')} onProfile={() => navigation.navigate('CustomerProfile')} onOpenChat={(rideId, captainName) => navigation.navigate('CustomerRideChat', { rideId, captainName })} onPickupOtpIssued={(pickupOtp) => setCustomerRide((currentRide) => currentRide.id === customerRide.id ? { ...currentRide, pickupOtp } : currentRide)} onShareLiveRide={(rideId) => navigation.navigate('LiveRideShare', { rideId })} />}</Stack.Screen>
          <Stack.Screen name="LiveRideShare">{({ navigation, route }) => <LiveRideShareScreen rideId={(route.params as { rideId: string }).rideId} onBack={() => navigation.goBack()} />}</Stack.Screen>
          <Stack.Screen name="CustomerRideChat">{({ navigation, route }) => { const { rideId, captainName } = route.params as { rideId: string; captainName: string }; return <CustomerRideChat rideId={rideId} captainName={captainName} onBack={() => navigation.goBack()} />; }}</Stack.Screen>
          <Stack.Screen name="CustomerPaymentIssueSupport">{({ navigation, route }) => <CustomerPaymentIssueSupportScreen rideId={(route.params as { rideId: string }).rideId} onBack={() => navigation.goBack()} />}</Stack.Screen>
          <Stack.Screen name="CustomerBookings">{({ navigation }) => <CustomerBookingsScreen ride={customerRide} onHome={openCustomerHome} onProfile={() => navigation.navigate('CustomerProfile')} onCancelled={() => { setCustomerRideStatus('cancelled'); setCustomerRideResolution('none'); navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onOpenSupport={(rideId) => navigation.navigate('CustomerPaymentIssueSupport', { rideId })} onOpenRide={(selectedRide, status) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; setCustomerRide(selectedRide); setCustomerRideStatus(status); if (status === 'cancelled' || status === 'completed') { setLocationTarget('pickup'); navigation.navigate('LocationPicker'); } else if (status === 'requested' || status === 'searching') navigation.navigate('Searching'); else navigation.navigate('RideConfirmed'); }); }} />}</Stack.Screen>
          <Stack.Screen name="CustomerProfile">{({ navigation }) => <CustomerProfileScreen onHome={openCustomerHome} onBookings={() => navigation.navigate('CustomerBookings')} onSettings={() => navigation.navigate('Settings')} onSafety={() => navigation.navigate('EmergencyContacts')} onAccountDeleted={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerAuthChoice' }] })} />}</Stack.Screen>
        </> : mode === 'captain' ? <>
          {captainAccountStatus === 'approved' ? <Stack.Screen name="CaptainMain">{() => <CaptainMainStack online={captainOnline} onToggle={() => setCaptainOnline((online) => !online)} onLanguageChange={chooseLanguage} onTripComplete={() => setCaptainOnline(true)} onAccountDeleted={() => { setCaptainOnline(false); setCaptainAccountStatus('unauthenticated'); setCaptainOnboardingRoute('signup'); }} />}</Stack.Screen> : <Stack.Screen name="CaptainOnboarding">{() => <CaptainOnboardingStack language={language} onLanguageChange={chooseLanguage} profile={captainProfile} onProfileChange={setCaptainProfile} onExit={onExit} onboardingRoute={captainAccountStatus === 'unauthenticated' ? 'signup' : captainOnboardingRoute} onOtpVerified={completeCaptainOtp} onSubmitted={submitCaptainOnboarding} onApproved={completeCaptainOnboarding} />}</Stack.Screen>}
        </> : mode === 'operator' ? <>
          <Stack.Screen name="OperatorLogin">{({ navigation }) => <CustomerLoginScreen onComplete={() => navigation.replace('OperatorReconciliation')} onBack={onExit} />}</Stack.Screen>
          <Stack.Screen name="OperatorReconciliation">{() => <OperatorReconciliationScreen onExit={onExit} />}</Stack.Screen>
        </> : null}
        <Stack.Screen name="LiveRideTracking">{({ navigation, route }) => <LiveRideTrackingScreen token={(route.params as { token: string }).token} onClose={() => navigation.goBack()} />}</Stack.Screen>
        <Stack.Screen name="Settings">{({ navigation, route }) => <SettingsScreen profile={Boolean((route.params as { profile?: boolean } | undefined)?.profile)} ratingRole={mode === 'customer' ? 'customer' : undefined} onBack={() => navigation.goBack()} onLanguageChange={(next) => { chooseLanguage(next).then(() => navigation.goBack()); }} onSafety={mode === 'customer' ? () => navigation.navigate('EmergencyContacts') : undefined} onAbout={() => navigation.navigate('About')} onAccountDeleted={mode === 'customer' ? () => navigation.reset({ index: 0, routes: [{ name: 'CustomerAuthChoice' }] }) : undefined} />}</Stack.Screen>
        <Stack.Screen name="About">{({ navigation }) => <AboutScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
        <Stack.Screen name="EmergencyContacts">{({ navigation }) => <EmergencyContactsScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
    </GestureHandlerRootView>
    </DialogProvider>
  </I18nextProvider>;
}
