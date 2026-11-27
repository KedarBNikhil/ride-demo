import { CustomerIntro } from '../components/CustomerIntro';
import { createNavigationContainerRef, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ActivityIndicator, AppState, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createAppI18n, type AppLanguage } from '../i18n/createI18n';
import { CustomerProfileScreen } from '../screens/CustomerProfileScreen';
import { EmergencyContactsScreen } from '../screens/EmergencyContactsScreen';
import { LiveRideShareScreen } from '../screens/LiveRideShareScreen';
import { LiveRideTrackingScreen } from '../screens/LiveRideTrackingScreen';
import { AboutScreen } from '../screens/AboutScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { DialogProvider } from '../components/ThemedDialog';
import { BookingConfirmScreen, CustomerAuthChoiceScreen, CustomerBookingsScreen, CustomerHomeScreen, CustomerLoginScreen, CustomerSignupScreen, type CustomerRide, LocationPickerScreen, RideConfirmedScreen, RideTypeScreen, SearchingScreen } from '../screens/CustomerScreens';
import { CustomerRideChat } from '../components/CustomerRideChat';
import { CustomerPaymentIssueSupportScreen } from '../screens/CustomerPaymentIssueSupportScreen';
import { CustomerIssueDetailsScreen, CustomerIssueHistoryScreen } from '../screens/CustomerIssueHistoryScreens';
import { SaveAddressPickerScreen, SavedAddressesScreen } from '../screens/SavedAddressesScreen';
import { customerRideLifecycle, isCustomerActiveRideStatus, rideDispatchService, type DispatchRide, type RideStatus } from '../services/rideDispatch';
import { configurePushNotifications, registerPushNotifications, subscribeToCustomerRideNotificationResponses } from '../services/pushNotifications';
import { supabase } from '../lib/supabase';
import { missingCustomerBookingLocation, toReusableCustomerBookingDraft } from '../services/customerBookingDraft';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();
const customerNavigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    border: colors.border,
    card: colors.bg,
    primary: colors.primary,
    text: colors.textPrimary,
  },
};
const currentRouteName = () => (navigationRef.getCurrentRoute() as { name?: string } | undefined)?.name;
const customerBookingRouteNames = new Set(['CustomerHome', 'LocationPicker', 'RideType', 'BookingConfirm']);
const customerTopLevelRouteNames = new Set(['CustomerHome', 'CustomerBookings', 'CustomerProfile']);
type CustomerRideResolution = 'resolving' | 'active' | 'none';

export function CustomerAppNavigator() {
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasLanguage, setHasLanguage] = useState<boolean | null>(null);
  const [i18n] = useState(() => createAppI18n('en'));
  const [customerRide, setCustomerRide] = useState<CustomerRide>({ pickup: '', drop: '', kind: 'bike', passengerCount: 1 });
  const [customerRideStatus, setCustomerRideStatus] = useState<RideStatus | null>(null);
  const [customerRideResolution, setCustomerRideResolution] = useState<CustomerRideResolution>('resolving');
  const [captainRatingPrompt, setCaptainRatingPrompt] = useState<{ rideId: string; captainName: string } | null>(null);
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
  const openCurrentCustomerRide = useCallback((ride: DispatchRide) => { if (!navigationRef.isReady()) return; const target = ride.status === 'requested' || ride.status === 'searching' ? 'Searching' : 'RideConfirmed'; const current = currentRouteName(); if (current === 'CustomerRideChat' || current === 'LiveRideShare' || current === 'CustomerPaymentIssueSupport') return; const redirectKey = `${ride.id}:${target}`; if (current === target || activeRideRedirectRef.current === redirectKey) return; activeRideRedirectRef.current = redirectKey; navigationRef.reset({ index: 0, routes: [{ name: target as never }] }); activeRideRedirectRef.current = null; }, []);
  const reconcileCurrentCustomerRide = useCallback(async (): Promise<DispatchRide | null> => {
    if (!customerSessionReady || !hasCustomerSession) return null;
    if (activeRideSyncRef.current) { customerRideSyncPendingRef.current = true; return activeRideSyncRef.current; }
    setCustomerRideResolution('resolving');
    const sync = (async () => {
      const ride = await rideDispatchService.getCustomerCurrentRide(dismissedCompletedRideIdsRef.current);
      if (!ride) {
        setCustomerRideResolution('none');
        if (customerRideRef.current.id && !customerRideRef.current.id.startsWith('local-')) clearCustomerRide();
        if (navigationRef.isReady() && ['Searching', 'RideConfirmed'].includes(currentRouteName() ?? '')) {
          navigationRef.reset({ index: 0, routes: [{ name: 'CustomerHome' as never }] });
        }
        return null;
      }
      if (customerRideLifecycle(ride) === 'rating') {
        const captain = await rideDispatchService.getAssignedCaptain(ride.id).catch(() => null);
        setCaptainRatingPrompt({ rideId: ride.id, captainName: captain?.fullName || 'your captain' });
        setCustomerRideResolution('none');
        clearCustomerRide();
        if (navigationRef.isReady() && currentRouteName() !== 'CustomerHome') navigationRef.reset({ index: 0, routes: [{ name: 'CustomerHome' as never }] });
        return null;
      }
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
  const openCustomerTab = useCallback((tab: 'CustomerHome' | 'CustomerBookings' | 'CustomerProfile') => {
    if (!navigationRef.isReady()) return;
    if (currentRouteName() === tab) return;
    const currentRoutes = navigationRef.getRootState()?.routes ?? [];
    const existingIndex = currentRoutes.findIndex((route) => route.name === tab);
    if (existingIndex >= 0) {
      navigationRef.reset({ index: existingIndex, routes: currentRoutes.slice(0, existingIndex + 1) } as never);
      return;
    }
    const currentTopLevelIndex = currentRoutes.reduce((lastIndex, route, index) => customerTopLevelRouteNames.has(route.name) ? index : lastIndex, -1);
    const routes = currentTopLevelIndex >= 0
      ? [...currentRoutes.slice(0, currentTopLevelIndex + 1), { name: tab as never }]
      : [{ name: 'CustomerHome' as never }, { name: tab as never }];
    navigationRef.reset({ index: routes.length - 1, routes } as never);
  }, []);
  const openCustomerHome = useCallback((dismissCompletedRideId?: string, ratingPrompt?: { rideId: string; captainName: string }) => {
    if (dismissCompletedRideId) {
      dismissedCompletedRideIdsRef.current.add(dismissCompletedRideId);
      setCustomerRideResolution('none');
      clearCustomerRide();
    }
    setCaptainRatingPrompt(ratingPrompt ?? null);
    openCustomerTab('CustomerHome');
    void reconcileCurrentCustomerRide().then((currentRide) => { if (currentRide) openCurrentCustomerRide(currentRide); }).catch(() => undefined);
  }, [clearCustomerRide, openCurrentCustomerRide, openCustomerTab, reconcileCurrentCustomerRide]);
  const skipCaptainRating = useCallback(async (rideId: string) => {
    await rideDispatchService.skipCaptainRating(rideId);
    setCaptainRatingPrompt(null);
    void reconcileCurrentCustomerRide().catch(() => undefined);
  }, [reconcileCurrentCustomerRide]);
  useEffect(() => { void reconcileCurrentCustomerRide().catch(() => undefined); const subscription = AppState.addEventListener('change', (nextState) => { if (nextState === 'active') void reconcileCurrentCustomerRide().catch(() => undefined); }); return () => subscription.remove(); }, [reconcileCurrentCustomerRide]);
  useEffect(() => { if (!customerRide.id || customerRide.id.startsWith('local-')) return; return rideDispatchService.subscribeToRide(customerRide.id, (ride) => { setCustomerRideStatus(ride.status); void reconcileCurrentCustomerRide().catch(() => undefined); }); }, [customerRide.id, reconcileCurrentCustomerRide]);
  useEffect(() => subscribeToCustomerRideNotificationResponses(({ rideId, type }) => { if (type === 'customer_support_message') { if (navigationRef.isReady()) (navigationRef.navigate as (name: string, params: { rideId: string }) => void)('CustomerPaymentIssueSupport', { rideId }); return; } void rideDispatchService.getRide(rideId).then((ride) => { void reconcileCustomerRideRef.current().then((currentRide) => { if (!currentRide && navigationRef.isReady() && ride.status === 'cancelled') navigationRef.reset({ index: 0, routes: [{ name: 'CustomerBookings' as never }] }); }).catch(() => undefined); }).catch(() => undefined); }), []);
  const chooseLanguage = async (next: AppLanguage) => { setLanguage(next); await i18n.changeLanguage(next); await AsyncStorage.setItem('sawaari.customer.language', next); setHasLanguage(true); };
  if (hasLanguage === null || !customerSessionReady) return <View style={{ alignItems: 'center', backgroundColor: colors.bg, flex: 1, justifyContent: 'center' }}><ActivityIndicator color={colors.primary} /></View>;
  return <I18nextProvider i18n={i18n}><DialogProvider><GestureHandlerRootView style={{ backgroundColor: colors.bg, flex: 1 }}><NavigationContainer ref={navigationRef} theme={customerNavigationTheme} linking={{ prefixes: ['exp+nandyal-ride-customer://'], config: { screens: { LiveRideTracking: 'live-ride/:token' } } }} onReady={() => { void reconcileCurrentCustomerRide().catch(() => undefined); }} onStateChange={() => { if (customerBookingRouteNames.has(currentRouteName() ?? '')) void reconcileCurrentCustomerRide().catch(() => undefined); }}><Stack.Navigator initialRouteName="CustomerIntro" screenOptions={{ animation: 'none', contentStyle: { backgroundColor: colors.bg }, headerShown: false }}>
    <Stack.Screen name="CustomerIntro">{({ navigation }) => <CustomerIntro onComplete={() => navigation.replace(hasCustomerSession ? 'CustomerHome' : 'CustomerAuthChoice')} />}</Stack.Screen>
    <Stack.Screen name="CustomerAuthChoice">{({ navigation }) => <CustomerAuthChoiceScreen language={language} onLanguageChange={(next) => { void chooseLanguage(next); }} onLogin={() => navigation.navigate('CustomerLogin')} onSignup={() => navigation.navigate('CustomerSignup')} />}</Stack.Screen>
    <Stack.Screen name="CustomerLogin">{({ navigation }) => <CustomerLoginScreen language={language} onLanguageChange={(next) => { void chooseLanguage(next); }} onBack={() => navigation.goBack()} onComplete={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
    <Stack.Screen name="CustomerSignup">{({ navigation }) => <CustomerSignupScreen language={language} onLanguageChange={(next) => { void chooseLanguage(next); }} onBack={() => navigation.goBack()} onComplete={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
    <Stack.Screen name="CustomerHome" options={{ animation: 'none' }}>{({ navigation }) => <CustomerHomeScreen ride={customerRide} hasActiveRide={customerRideResolution !== 'none' || isCustomerActiveRideStatus(customerRideStatus)} onBack={() => undefined} onProfile={() => openCustomerTab('CustomerProfile')} onBookings={() => openCustomerTab('CustomerBookings')} onSaveDestination={(address, coordinate) => navigation.navigate('SaveAddressPicker', { initial: { address, coordinate } })} onPickLocation={(target) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setLocationTarget(target); navigation.navigate('LocationPicker'); } }); }} onChooseDestination={(drop, dropCoordinate, pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setCustomerRide((ride) => ({ ...ride, pickup: pickup ?? ride.pickup, pickupCoordinate: pickupCoordinate ?? ride.pickupCoordinate, drop, dropCoordinate, routeQuote: undefined })); setLocationTarget('drop'); navigation.navigate('LocationPicker'); } }); }} onStartBooking={(pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate, routeQuote: undefined })); setLocationTarget('drop'); navigation.navigate('LocationPicker'); } }); }} onPickupHere={(pickup, pickupCoordinate) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate, routeQuote: undefined })); setLocationTarget('pickup'); navigation.navigate('LocationPicker'); } }); }} ratingPrompt={captainRatingPrompt} onDismissRating={() => setCaptainRatingPrompt(null)} onSkipRating={skipCaptainRating} />}</Stack.Screen>
    <Stack.Screen name="LocationPicker">{({ navigation }) => <LocationPickerScreen ride={customerRide} initialTarget={locationTarget} onBack={() => navigation.goBack()} onChange={(target, place, coordinate) => setCustomerRide((ride) => ({ ...ride, [target]: place, routeQuote: undefined, [target === 'pickup' ? 'pickupCoordinate' : 'dropCoordinate']: coordinate }))} onContinue={() => { void allowCustomerBooking().then((allowed) => { if (allowed) navigation.navigate('RideType'); }); }} />}</Stack.Screen>
    <Stack.Screen name="RideType">{({ navigation }) => <RideTypeScreen ride={customerRide} selected={customerRide.kind} onBack={() => { if (navigation.canGoBack()) navigation.goBack(); else openCustomerHome(); }} onEditLocation={(target) => { void allowCustomerBooking().then((allowed) => { if (allowed) { setLocationTarget(target); navigation.navigate('LocationPicker'); } }); }} onInvalidRoute={(target) => { setLocationTarget(target); navigation.replace('LocationPicker'); }} onSelect={(kind) => setCustomerRide((ride) => ({ ...ride, kind, passengerCount: kind === 'bike' ? 1 : ride.passengerCount }))} onPassengerCountChange={(passengerCount) => setCustomerRide((ride) => ({ ...ride, passengerCount }))} onPaymentPreferenceChange={(paymentPreference, preferredUpiApp) => setCustomerRide((ride) => ({ ...ride, paymentPreference, preferredUpiApp }))} onRouteQuote={(routeQuote) => setCustomerRide((ride) => ({ ...ride, routeQuote }))} onNext={(bookingRide) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; const missingLocation = missingCustomerBookingLocation(bookingRide); if (missingLocation) { setLocationTarget(missingLocation); navigation.navigate('LocationPicker'); return; } navigation.navigate('BookingConfirm', { bookingRide }); }); }} unavailableMessage={searchUnavailableMessage ? 'No captains available at the moment. Please try again' : undefined} onUnavailableMessageHidden={() => setSearchUnavailableMessage(false)} />}</Stack.Screen>
    <Stack.Screen name="BookingConfirm">{({ navigation, route }) => { const bookingRide = (route.params as { bookingRide?: CustomerRide } | undefined)?.bookingRide ?? customerRide; return <BookingConfirmScreen ride={bookingRide} onBack={() => navigation.goBack()} onInvalidRoute={(target) => { setLocationTarget(target); navigation.replace('LocationPicker'); }} beforeBook={async () => { const missingLocation = missingCustomerBookingLocation(bookingRide); if (missingLocation) { setLocationTarget(missingLocation); navigation.replace('LocationPicker'); return false; } return allowCustomerBooking(); }} onBook={async (confirmedRide, rideId) => { customerRideRef.current = { ...confirmedRide, id: rideId, pickupOtp: undefined }; setCustomerRide(customerRideRef.current); setCustomerRideStatus('searching'); setCustomerRideResolution('active'); navigation.navigate('Searching'); }} />; }}</Stack.Screen>
    <Stack.Screen name="Searching">{({ navigation }) => <SearchingScreen rideId={customerRide.id} rideKind={customerRide.kind} pickupCoordinate={customerRide.pickupCoordinate} onBack={() => navigation.goBack()} onFound={() => navigation.replace('RideConfirmed')} onUnavailable={() => { clearCustomerRide(); setCustomerRideResolution('none'); setSearchUnavailableMessage(true); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onCancel={() => { setCustomerRideStatus(null); setCustomerRideResolution('none'); setCustomerRide((ride) => toReusableCustomerBookingDraft(ride)); navigation.reset({ index: 0, routes: [{ name: 'RideType' }] }); }} onHome={openCustomerHome} onBookings={() => openCustomerTab('CustomerBookings')} onProfile={() => openCustomerTab('CustomerProfile')} />}</Stack.Screen>
    <Stack.Screen name="RideConfirmed">{({ navigation }) => <RideConfirmedScreen ride={customerRide} onHome={openCustomerHome} onCancelled={() => { setCustomerRideStatus('cancelled'); setCustomerRideResolution('none'); setCustomerRide((ride) => ({ ...ride, routeQuote: undefined, pickupOtp: undefined })); navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onBookings={() => openCustomerTab('CustomerBookings')} onProfile={() => openCustomerTab('CustomerProfile')} onOpenChat={(rideId, captainName) => navigation.navigate('CustomerRideChat', { rideId, captainName })} onPickupOtpIssued={(pickupOtp) => setCustomerRide((currentRide) => currentRide.id === customerRide.id ? { ...currentRide, pickupOtp } : currentRide)} onShareLiveRide={(rideId) => navigation.navigate('LiveRideShare', { rideId })} />}</Stack.Screen>
    <Stack.Screen name="LiveRideShare">{({ navigation, route }) => <LiveRideShareScreen rideId={(route.params as { rideId: string }).rideId} onBack={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="CustomerRideChat">{({ navigation, route }) => { const { rideId, captainName } = route.params as { rideId: string; captainName: string }; return <CustomerRideChat rideId={rideId} captainName={captainName} onBack={() => navigation.goBack()} />; }}</Stack.Screen>
    <Stack.Screen name="CustomerPaymentIssueSupport">{({ navigation, route }) => <CustomerPaymentIssueSupportScreen rideId={(route.params as { rideId: string }).rideId} onBack={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="Help">{({ navigation }) => <HelpScreen onBack={() => navigation.goBack()} onSupportIssues={() => navigation.navigate('CustomerIssueHistory')} />}</Stack.Screen>
    <Stack.Screen name="CustomerIssueHistory">{({ navigation }) => <CustomerIssueHistoryScreen onBack={() => navigation.goBack()} onOpenIssue={(issueId) => navigation.navigate('CustomerIssueDetails', { issueId })} />}</Stack.Screen>
    <Stack.Screen name="CustomerIssueDetails">{({ navigation, route }) => <CustomerIssueDetailsScreen issueId={(route.params as { issueId: string }).issueId} onBack={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="CustomerBookings" options={{ animation: 'none' }}>{({ navigation }) => <CustomerBookingsScreen ride={customerRide} onHome={openCustomerHome} onProfile={() => openCustomerTab('CustomerProfile')} onCancelled={() => { setCustomerRideStatus('cancelled'); setCustomerRideResolution('none'); navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] }); }} onOpenSupport={(rideId) => navigation.navigate('CustomerPaymentIssueSupport', { rideId })} onOpenIssue={(issueId) => navigation.navigate('CustomerIssueDetails', { issueId })} onOpenRide={(selectedRide, status) => { void allowCustomerBooking().then((allowed) => { if (!allowed) return; if (status === 'cancelled' || status === 'completed') { const bookingDraft = toReusableCustomerBookingDraft(selectedRide); setCustomerRide(bookingDraft); setCustomerRideStatus(null); setCustomerRideResolution('none'); const missingLocation = missingCustomerBookingLocation(bookingDraft); if (missingLocation) { setLocationTarget(missingLocation); navigation.navigate('LocationPicker'); } else navigation.navigate('RideType'); return; } setCustomerRide(selectedRide); setCustomerRideStatus(status); if (status === 'requested' || status === 'searching') navigation.navigate('Searching'); else navigation.navigate('RideConfirmed'); }); }} />}</Stack.Screen>
    <Stack.Screen name="CustomerProfile" options={{ animation: 'none' }}>{({ navigation }) => <CustomerProfileScreen onHome={openCustomerHome} onBookings={() => openCustomerTab('CustomerBookings')} onHelp={() => navigation.navigate('Help')} onSavedAddresses={() => navigation.navigate('SavedAddresses')} onSettings={() => navigation.navigate('Settings', { languageOnly: true })} onSafety={() => navigation.navigate('EmergencyContacts')} onAbout={() => navigation.navigate('About')} onAccountDeleted={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerAuthChoice' }] })} onLoggedOut={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerAuthChoice' }] })} />}</Stack.Screen>
    <Stack.Screen name="SavedAddresses">{({ navigation }) => <SavedAddressesScreen onBack={() => navigation.goBack()} onAdd={(item) => navigation.navigate('SaveAddressPicker', item ? { initial: { address: item.address, coordinate: { latitude: item.latitude, longitude: item.longitude }, label: item.label } } : undefined)} />}</Stack.Screen>
    <Stack.Screen name="SaveAddressPicker">{({ navigation, route }) => <SaveAddressPickerScreen initial={(route.params as { initial?: { address: string; coordinate: { latitude: number; longitude: number }; label?: string } } | undefined)?.initial} onBack={() => navigation.goBack()} onSaved={() => navigation.replace('SavedAddresses')} />}</Stack.Screen>
    <Stack.Screen name="LiveRideTracking">{({ navigation, route }) => <LiveRideTrackingScreen token={(route.params as { token: string }).token} onClose={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="Settings">{({ navigation, route }) => <SettingsScreen profile={Boolean((route.params as { profile?: boolean } | undefined)?.profile)} languageOnly={Boolean((route.params as { languageOnly?: boolean } | undefined)?.languageOnly)} ratingRole="customer" onBack={() => navigation.goBack()} onLanguageChange={(next) => { void chooseLanguage(next).then(() => navigation.goBack()); }} onSafety={() => navigation.navigate('EmergencyContacts')} onAbout={() => navigation.navigate('About')} onAccountDeleted={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerAuthChoice' }] })} />}</Stack.Screen>
    <Stack.Screen name="About">{({ navigation }) => <AboutScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
    <Stack.Screen name="EmergencyContacts">{({ navigation }) => <EmergencyContactsScreen onBack={() => navigation.goBack()} />}</Stack.Screen>
  </Stack.Navigator></NavigationContainer></GestureHandlerRootView></DialogProvider></I18nextProvider>;
}
