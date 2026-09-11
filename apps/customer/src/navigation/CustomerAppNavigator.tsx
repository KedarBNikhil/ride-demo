import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ActivityIndicator, AppState, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createAppI18n, type AppLanguage } from '../i18n/createI18n';
import { CustomerProfileScreen } from '../screens/CustomerProfileScreen';
import { EmergencyContactsScreen } from '../screens/EmergencyContactsScreen';
import { LiveRideShareScreen } from '../screens/LiveRideShareScreen';
import { LiveRideTrackingScreen } from '../screens/LiveRideTrackingScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { DialogProvider } from '../components/ThemedDialog';
import { BookingConfirmScreen, CustomerAuthChoiceScreen, CustomerBookingsScreen, CustomerHomeScreen, CustomerIntroScreen, CustomerLoginScreen, CustomerSignupScreen, type CustomerRide, LocationPickerScreen, RideConfirmedScreen, RideTypeScreen, SearchingScreen } from '../screens/CustomerScreens';
import { CustomerRideChat } from '../components/CustomerRideChat';
import { CustomerPaymentIssueSupportScreen } from '../screens/CustomerPaymentIssueSupportScreen';
import { customerRideLifecycle, isCustomerActiveRideStatus, rideDispatchService, type DispatchRide, type RideStatus } from '../services/rideDispatch';
import { configurePushNotifications, registerPushNotifications, subscribeToCustomerRideNotificationResponses } from '../services/pushNotifications';
import { supabase } from '../lib/supabase';
import { missingCustomerBookingLocation, toReusableCustomerBookingDraft } from '../services/customerBookingDraft';

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();
const currentRouteName = () => (navigationRef.getCurrentRoute() as { name?: string } | undefined)?.name;
const customerBookingRouteNames = new Set(['CustomerHome', 'LocationPicker', 'RideType', 'BookingConfirm']);
type CustomerRideResolution = 'resolving' | 'active' | 'none';

export function CustomerAppNavigator() {
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasLanguage, setHasLanguage] = useState<boolean | null>(null);
  const [i18n] = useState(() => createAppI18n('en'));
  const [customerRide, setCustomerRide] = useState<CustomerRide>({ pickup: '', drop: '', kind: 'bike', passengerCount: 1 });
  const [customerRideStatus, setCustomerRideStatus] = useState<RideStatus | null>(null);
  const [customerRideResolution, setCustomerRideResolution] = useState<CustomerRideResolution>('resolving');
  const [searchUnavailableMessage, setSearchUnavailableMessage] = useState(false);
  const [locationTarget, setLocationTarget] = useState<'pickup' | 'drop'>('pickup');
  const [customerSessionReady, setCustomerSessionReady] = useState(false);
  const [hasCustomerSession, setHasCustomerSession] = useState(false);
  const customerRideRef = useRef(customerRide);
  const activeRideSyncRef = useRef<Promise<DispatchRide | null> | null>(null);
  const customerRideSyncPendingRef = useRef(false);
  const reconcileCustomerRideRef = useRef<() => Promise<DispatchRide | null>>(async () => null);
  const activeRideRedirectRef = useRef<string | null>(null);
  const dismissedCompletedRideIdsRef = useRef(new Set<string>());

  useEffect(() => { configurePushNotifications(); }, []);
  useEffect(() => {
    AsyncStorage.getItem('sawaari.customer.language').then((saved) => {
      if (saved === 'en' || saved === 'te') { setLanguage(saved); void i18n.changeLanguage(saved); setHasLanguage(true); }
      else setHasLanguage(false);
    });
  }, [i18n]);
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const register = (hasSession: boolean) => { if (mounted && hasSession) void registerPushNotifications('customer').catch(() => undefined); };
    void supabase.auth.getSession().then(({ data: { session } }) => register(Boolean(session)));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => register(Boolean(session)));
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!supabase) { setHasCustomerSession(false); setCustomerSessionReady(true); return; }
    let mounted = true;
    const apply = (session: unknown) => { if (mounted) { setHasCustomerSession(Boolean(session)); setCustomerRideResolution(session ? 'resolving' : 'none'); setCustomerSessionReady(true); } };
    void supabase.auth.getSession().then(({ data: { session } }) => apply(session)).catch(() => apply(null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  const customerRideFromDispatch = (ride: DispatchRide): CustomerRide => ({ id: ride.id, kind: ride.ride_type, passengerCount: ride.ride_type === 'auto' ? Number(ride.passenger_count ?? 1) : 1, pickup: ride.pickup_address, drop: ride.drop_address, ...(ride.pickup_latitude != null && ride.pickup_longitude != null ? { pickupCoordinate: { latitude: Number(ride.pickup_latitude), longitude: Number(ride.pickup_longitude) } } : {}), ...(ride.drop_latitude != null && ride.drop_longitude != null ? { dropCoordinate: { latitude: Number(ride.drop_latitude), longitude: Number(ride.drop_longitude) } } : {}) });
  useEffect(() => { customerRideRef.current = customerRide; }, [customerRide]);
  const clearCustomerRide = useCallback(() => { setCustomerRideStatus('cancelled'); setCustomerRide((ride) => toReusableCustomerBookingDraft(ride)); }, []);
  const openCurrentCustomerRide = useCallback((ride: DispatchRide) => { if (!navigationRef.isReady()) return; const target = ride.status === 'requested' || ride.status === 'searching' ? 'Searching' : 'RideConfirmed'; const redirectKey = `${ride.id}:${target}`; if (currentRouteName() === target || activeRideRedirectRef.current === redirectKey) return; activeRideRedirectRef.current = redirectKey; navigationRef.reset({ index: 0, routes: [{ name: target as never }] }); activeRideRedirectRef.current = null; }, []);
  const reconcileCurrentCustomerRide = useCallback(async (): Promise<DispatchRide | null> => {
    if (!customerSessionReady || !hasCustomerSession) return null;
    if (activeRideSyncRef.current) { customerRideSyncPendingRef.current = true; return activeRideSyncRef.current; }
    setCustomerRideResolution('resolving');
    const sync = (async () => {
      const ride = await rideDispatchService.getCustomerCurrentRide(dismissedCompletedRideIdsRef.current);
      if (!ride) { setCustomerRideResolution('none'); if (customerRideRef.current.id && !customerRideRef.current.id.startsWith('local-')) clearCustomerRide(); return null; }
      const pickupOtp = ride.status === 'arrived' ? await rideDispatchService.getStoredCustomerPickupOtp(ride.id) : null;
      setCustomerRide({ ...customerRideFromDispatch(ride), ...(pickupOtp ? { pickupOtp } : {}) }); setCustomerRideStatus(ride.status); setCustomerRideResolution('active');
      if (ride.status === 'arrived' && !pickupOtp) void rideDispatchService.issueCustomerPickupOtp(ride.id).then((otp) => { if (otp) setCustomerRide((current) => current.id === ride.id ? { ...current, pickupOtp: otp } : current); }).catch(() => undefined);
      openCurrentCustomerRide(ride); return ride;
    })();
    activeRideSyncRef.current = sync;
    try { return await sync; } finally { activeRideSyncRef.current = null; if (customerRideSyncPendingRef.current) { customerRideSyncPendingRef.current = false; void reconcileCurrentCustomerRide().catch(() => undefined); } }
  }, [clearCustomerRide, customerSessionReady, hasCustomerSession, openCurrentCustomerRide]);
  reconcileCustomerRideRef.current = reconcileCurrentCustomerRide;
  const allowCustomerBooking = useCallback(async () => { try { const currentRide = await reconcileCurrentCustomerRide(); if (!currentRide) return true; openCurrentCustomerRide(currentRide); } catch { /* fail closed */ } return false; }, [openCurrentCustomerRide, reconcileCurrentCustomerRide]);
  const openCustomerHome = useCallback((dismissCompletedRideId?: string) => {
    if (dismissCompletedRideId) {
      dismissedCompletedRideIdsRef.current.add(dismissCompletedRideId);
      setCustomerRideResolution('none');
      clearCustomerRide();
      if (navigationRef.isReady() && currentRouteName() !== 'CustomerHome') navigationRef.reset({ index: 0, routes: [{ name: 'CustomerHome' as never }] });
    }
    void reconcileCurrentCustomerRide().then((currentRide) => { if (!currentRide && navigationRef.isReady() && currentRouteName() !== 'CustomerHome') navigationRef.reset({ index: 0, routes: [{ name: 'CustomerHome' as never }] }); }).catch(() => undefined);
  }, [clearCustomerRide, reconcileCurrentCustomerRide]);
  useEffect(() => { void reconcileCurrentCustomerRide().catch(() => undefined); const subscription = AppState.addEventListener('change', (nextState) => { if (nextState === 'active') void reconcileCurrentCustomerRide().catch(() => undefined); }); return () => subscription.remove(); }, [reconcileCurrentCustomerRide]);
  useEffect(() => { if (!customerRide.id || customerRide.id.startsWith('local-')) return; return rideDispatchService.subscribeToRide(customerRide.id, (ride) => { setCustomerRideStatus(ride.status); void reconcileCurrentCustomerRide().catch(() => undefined); }); }, [customerRide.id, reconcileCurrentCustomerRide]);
  useEffect(() => subscribeToCustomerRideNotificationResponses(({ rideId }) => { void rideDispatchService.getRide(rideId).then((ride) => { void reconcileCustomerRideRef.current().then((currentRide) => { if (!currentRide && navigationRef.isReady() && ride.status === 'cancelled') navigationRef.reset({ index: 0, routes: [{ name: 'CustomerBookings' as never }] }); }).catch(() => undefined); }).catch(() => undefined); }), []);
  const chooseLanguage = async (next: AppLanguage) => { setLanguage(next); await i18n.changeLanguage(next); await AsyncStorage.setItem('sawaari.customer.language', next); setHasLanguage(true); };
  if (hasLanguage === null || !customerSessionReady) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  return <I18nextProvider i18n={i18n}><DialogProvider><GestureHandlerRootView style={{ flex: 1 }}><NavigationContainer ref={navigationRef} linking={{ prefixes: ['exp+nandyal-ride-customer://'], config: { screens: { LiveRideTracking: 'live-ride/:token' } } }} onReady={() => { void reconcileCurrentCustomerRide().catch(() => undefined); }} onStateChange={() => { if (customerBookingRouteNames.has(currentRouteName() ?? '')) void reconcileCurrentCustomerRide().catch(() => undefined); }}><Stack.Navigator initialRouteName="CustomerIntro" screenOptions={{ headerShown: false, animation: Platform.OS === 'ios' ? 'slide_from_right' : 'slide_from_right', animationDuration: 260 }}>
    <Stack.Screen name="CustomerIntro" options={{ animation: 'fade' }}>{({ navigation }) => <CustomerIntroScreen onComplete={() => navigation.replace(hasCustomerSession ? 'CustomerHome' : 'CustomerAuthChoice')} />}</Stack.Screen>
    <Stack.Screen name="CustomerAuthChoice">{({ navigation }) => <CustomerAuthChoiceScreen onLogin={() => navigation.navigate('CustomerLogin')} onSignup={() => navigation.navigate('CustomerSignup')} />}</Stack.Screen>
    <Stack.Screen name="CustomerLogin">{({ navigation }) => <CustomerLoginScreen onBack={() => navigation.goBack()} onComplete={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
    <Stack.Screen name="CustomerSignup">{({ navigation }) => <CustomerSignupScreen onBack={() => navigation.goBack()} onComplete={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
    <Stack.Screen name="CustomerHome">{({ navigation }) => <CustomerHomeScreen ride={customerRide} hasActiveRide={customerRideResolution !== 'none' || isCustomerActiveRideStatus(customerRideStatus)} onBack={() => undefined} onProfile={() => navigation.navigate('CustomerProfile')} onBookings={() => navigation.navigate('CustomerBookings')} onPickLocation={(target) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setLocationTarget(target); navigation.navigate('LocationPicker'); } }); }} onChooseDestination={(drop, dropCoordinate, pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setCustomerRide((ride) => ({ ...ride, pickup: pickup ?? ride.pickup, pickupCoordinate: pickupCoordinate ?? ride.pickupCoordinate, drop, dropCoordinate, routeQuote: undefined })); setLocationTarget('drop'); navigation.navigate('LocationPicker'); } }); }} onStartBooking={(pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate, routeQuote: undefined })); setLocationTarget('drop'); navigation.navigate('LocationPicker'); } }); }} onPickupHere={(pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate, routeQuote: undefined })); setLocationTarget('pickup'); navigation.navigate('LocationPicker'); } }); }} />}</Stack.Screen>
    <Stack.Screen name="LocationPicker">{({ navigation }) => <LocationPickerScreen ride={customerRide} initialTarget={locationTarget} onBack={() => navigation.goBack()} onChange={(target, place, coordinate) => setCustomerRide((ride) => ({ ...ride, [target]: place, routeQuote: undefined, [target === 'pickup' ? 'pickupCoordinate' : 'dropCoordinate']: coordinate }))} onContinue={() => { void allowCustomerBooking().then((allowed) => { if (allowed) navigation.navigate('RideType'); }); }} />}</Stack.Screen>
    <Stack.Screen name="RideType">{({ navigation }) => <RideTypeScreen ride={customerRide} selected={customerRide.kind} onBack={() => { if (navigation.canGoBack()) navigation.goBack(); else openCustomerHome(); }} onEditLocation={(target) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setLocationTarget(target); navigation.navigate('LocationPicker'); } }); }} onInvalidRoute={(target) => { setLocationTarget(target); navigation.replace('LocationPicker'); }} onSelect={(kind) => setCustomerRide((ride) => ({ ...ride, kind, passengerCount: kind === 'bike' ? 1 : ride.passengerCount }))} onPassengerCountChange={(passengerCount) => setCustomerRide((ride) => ({ ...ride, passengerCount }))} onRouteQuote={(routeQuote) => setCustomerRide((ride) => ({ ...ride, routeQuote }))} onNext={(bookingRide) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; const missingLocation = missingCustomerBookingLocation(bookingRide); if (missingLocation) { setLocationTarget(missingLocation); navigation.navigate('LocationPicker'); return; } navigation.navigate('BookingConfirm', { bookingRide }); }); }} unavailableMessage={searchUnavailableMessage ? 'No captains available at the moment. Please try again' : undefined} onUnavailableMessageHidden={() => setSearchUnavailableMessage(false)} />}</Stack.Screen>
    <Stack.Screen name="BookingConfirm">{({ navigation, route }) => { const bookingRide = (route.params as { bookingRide?: CustomerRide } | undefined)?.bookingRide ?? customerRide; return <BookingConfirmScreen ride={bookingRide} onBack={() => navigation.goBack()} onInvalidRoute={(target) => { setLocationTarget(target); navigation.replace('LocationPicker'); }} beforeBook={async () => { const missingLocation = missingCustomerBookingLocation(bookingRide); if (missingLocation) { setLocationTarget(missingLocation); navigation.replace('LocationPicker'); return false; } return allowCustomerBooking(); }} onBook={async (confirmedRide, rideId) => { customerRideRef.current = { ...confirmedRide, id: rideId, pickupOtp: undefined }; setCustomerRide(customerRideRef.current); setCustomerRideStatus('searching'); setCustomerRideResolution('active'); navigation.navigate('Searching'); }} />; }}</Stack.Screen>
    <Stack.Screen name="Searching" options={{ animation: 'fade' }}>{({ navigation }) => <SearchingScreen rideId={customerRide.id} rideKind={customerRide.kind} pickupCoordinate={customerRide.pickupCoordinate} onBack={() => navigation.goBack()} onFound={() => navigation.replace('RideConfirmed')} onUnavailable={() => { clearCustomerRide(); setCustomerRideResolution('none'); setSearchUnavailableMessage(true); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onCancel={() => { setCustomerRideStatus(null); setCustomerRideResolution('none'); setCustomerRide((ride) => toReusableCustomerBookingDraft(ride)); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onHome={openCustomerHome} onBookings={() => navigation.navigate('CustomerBookings')} onProfile={() => navigation.navigate('CustomerProfile')} />}</Stack.Screen>
    <Stack.Screen name="RideConfirmed" options={{ animation: 'fade' }}>{({ navigation }) => <RideConfirmedScreen ride={customerRide} onHome={openCustomerHome} onCancelled={() => { setCustomerRideStatus('cancelled'); setCustomerRideResolution('none'); setCustomerRide((ride) => ({ ...ride, routeQuote: undefined, pickupOtp: undefined })); navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onBookings={() => navigation.navigate('CustomerBookings')} onProfile={() => navigation.navigate('CustomerProfile')} onOpenChat={(rideId, captainName) => navigation.navigate('CustomerRideChat', { rideId, captainName })} onPickupOtpIssued={(pickupOtp) => setCustomerRide((currentRide) => currentRide.id === customerRide.id ? { ...currentRide, pickupOtp } : currentRide)} onShareLiveRide={(rideId) => navigation.navigate('LiveRideShare', { rideId })} />}</Stack.Screen>
    <Stack.Screen name="LiveRideShare">{({ navigation, route }) => <LiveRideShareScreen rideId={(route.params as { rideId: string }).rideId} onBack={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="CustomerRideChat">{({ navigation, route }) => { const { rideId, captainName } = route.params as { rideId: string; captainName: string }; return <CustomerRideChat rideId={rideId} captainName={captainName} onBack={() => navigation.goBack()} />; }}</Stack.Screen>
    <Stack.Screen name="CustomerPaymentIssueSupport">{({ navigation, route }) => <CustomerPaymentIssueSupportScreen rideId={(route.params as { rideId: string }).rideId} onBack={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="CustomerBookings">{({ navigation }) => <CustomerBookingsScreen ride={customerRide} onHome={openCustomerHome} onProfile={() => navigation.navigate('CustomerProfile')} onCancelled={() => { setCustomerRideStatus('cancelled'); setCustomerRideResolution('none'); navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onOpenSupport={(rideId) => navigation.navigate('CustomerPaymentIssueSupport', { rideId })} onOpenRide={(selectedRide, status) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; if (status === 'cancelled' || status === 'completed') { const bookingDraft = toReusableCustomerBookingDraft(selectedRide); setCustomerRide(bookingDraft); setCustomerRideStatus(null); setCustomerRideResolution('none'); const missingLocation = missingCustomerBookingLocation(bookingDraft); if (missingLocation) { setLocationTarget(missingLocation); navigation.navigate('LocationPicker'); } else navigation.navigate('RideType'); return; } setCustomerRide(selectedRide); setCustomerRideStatus(status); if (status === 'requested' || status === 'searching') navigation.navigate('Searching'); else navigation.navigate('RideConfirmed'); }); }} />}</Stack.Screen>
    <Stack.Screen name="CustomerProfile">{({ navigation }) => <CustomerProfileScreen onHome={openCustomerHome} onBookings={() => navigation.navigate('CustomerBookings')} onSettings={() => navigation.navigate('Settings')} onSafety={() => navigation.navigate('EmergencyContacts')} onAccountDeleted={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerAuthChoice' }] })} />}</Stack.Screen>
    <Stack.Screen name="LiveRideTracking">{({ navigation, route }) => <LiveRideTrackingScreen token={(route.params as { token: string }).token} onClose={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="Settings">{({ navigation, route }) => <SettingsScreen profile={Boolean((route.params as { profile?: boolean } | undefined)?.profile)} ratingRole="customer" onBack={() => navigation.goBack()} onLanguageChange={(next) => { void chooseLanguage(next).then(() => navigation.goBack()); }} onSafety={() => navigation.navigate('EmergencyContacts')} onAbout={() => navigation.navigate('About')} onAccountDeleted={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerAuthChoice' }] })} />}</Stack.Screen>
    <Stack.Screen name="About">{({ navigation }) => <AboutScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="EmergencyContacts">{({ navigation }) => <EmergencyContactsScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
  </Stack.Navigator></NavigationContainer></GestureHandlerRootView></DialogProvider></I18nextProvider>;
}
