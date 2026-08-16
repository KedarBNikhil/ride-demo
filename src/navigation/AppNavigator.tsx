import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ActivityIndicator, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createAppI18n, type AppLanguage } from '../i18n/createI18n';
import { LanguageSelectScreen } from '../screens/LanguageSelectScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { BookingConfirmScreen, CustomerHomeScreen, CustomerLoginScreen, type CustomerRide, LocationPickerScreen, RideConfirmedScreen, RideTypeScreen, SearchingScreen } from '../screens/CustomerScreens';
import { CaptainOnboardingStack } from './CaptainOnboardingStack';
import { CaptainMainStack } from './CaptainMainStack';
import type { CaptainProfile } from '../services/captainOnboarding';

export type AppMode = 'customer' | 'captain';
const Stack = createNativeStackNavigator();
const CAPTAIN_ONBOARDING_FLOW_VERSION = '3';
const captainOnboardingCompleteKey = 'nandyal-ride-demo.captain.onboardingComplete';
const captainOnboardingSubmittedKey = 'nandyal-ride-demo.captain.onboardingSubmitted';
const captainOnboardingVersionKey = 'nandyal-ride-demo.captain.onboardingFlowVersion';

export function AppNavigator({ mode, onExit }: { mode: AppMode; onExit: () => void }) {
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasLanguage, setHasLanguage] = useState<boolean | null>(null);
  const [i18n] = useState(() => createAppI18n('en'));
  const [customerRide, setCustomerRide] = useState<CustomerRide>({ pickup: '', drop: '', kind: 'bike' });
  const [locationTarget, setLocationTarget] = useState<'pickup' | 'drop'>('pickup');
  const [captainOnline, setCaptainOnline] = useState(false);
  const [captainProfile, setCaptainProfile] = useState<CaptainProfile>({ name: '', language: 'en', vehicleType: null });
  const [captainOnboardingComplete, setCaptainOnboardingComplete] = useState<boolean | null>(mode === 'captain' ? null : false);
  const [captainOnboardingSubmitted, setCaptainOnboardingSubmitted] = useState<boolean | null>(mode === 'captain' ? null : false);
  const storageKey = `nandyal-ride-demo.${mode}.language`;

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (saved === 'en' || saved === 'te') { setLanguage(saved); i18n.changeLanguage(saved); setHasLanguage(true); }
      else setHasLanguage(false);
    });
  }, [i18n, storageKey]);

  useEffect(() => {
    if (mode !== 'captain') return;
    void (async () => {
      const version = await AsyncStorage.getItem(captainOnboardingVersionKey);
      if (version !== CAPTAIN_ONBOARDING_FLOW_VERSION) {
        await AsyncStorage.multiRemove([captainOnboardingCompleteKey, captainOnboardingSubmittedKey]);
        await AsyncStorage.setItem(captainOnboardingVersionKey, CAPTAIN_ONBOARDING_FLOW_VERSION);
        setCaptainOnboardingComplete(false);
        setCaptainOnboardingSubmitted(false);
        return;
      }
      const [[, complete], [, submitted]] = await AsyncStorage.multiGet([captainOnboardingCompleteKey, captainOnboardingSubmittedKey]);
      setCaptainOnboardingComplete(complete === 'true');
      setCaptainOnboardingSubmitted(submitted === 'true' && complete !== 'true');
    })();
  }, [mode]);

  const chooseLanguage = async (next: AppLanguage) => {
    setLanguage(next);
    await i18n.changeLanguage(next);
    await AsyncStorage.setItem(storageKey, next);
    setHasLanguage(true);
  };

  const submitCaptainOnboarding = async () => { await AsyncStorage.setItem(captainOnboardingSubmittedKey, 'true'); setCaptainOnboardingSubmitted(true); };
  const completeCaptainOnboarding = async () => { await AsyncStorage.multiRemove([captainOnboardingSubmittedKey]); await AsyncStorage.setItem(captainOnboardingCompleteKey, 'true'); setCaptainOnboardingSubmitted(false); setCaptainOnboardingComplete(true); };
  if (hasLanguage === null || (mode === 'captain' && (captainOnboardingComplete === null || captainOnboardingSubmitted === null))) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  return <I18nextProvider i18n={i18n}>
    <GestureHandlerRootView style={{ flex: 1 }}>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: Platform.OS === 'ios' ? 'slide_from_right' : 'slide_from_right', animationDuration: 260 }}>
        {!hasLanguage && <Stack.Screen name="LanguageSelect">{() => <LanguageSelectScreen onChoose={chooseLanguage} />}</Stack.Screen>}
        {mode === 'customer' ? <>
          <Stack.Screen name="CustomerLogin">{({ navigation }) => <CustomerLoginScreen onComplete={() => navigation.navigate('CustomerHome')} onBack={onExit} />}</Stack.Screen>
          <Stack.Screen name="CustomerHome">{({ navigation }) => <CustomerHomeScreen ride={customerRide} onBack={onExit} onProfile={() => navigation.navigate('Settings', { profile: true })} onPickLocation={(target) => { setLocationTarget(target); navigation.navigate('LocationPicker'); }} onStartBooking={(pickup, pickupCoordinate) => { setCustomerRide((ride) => ({ ...ride, pickup, pickupCoordinate })); setLocationTarget('drop'); navigation.navigate('LocationPicker'); }} />}</Stack.Screen>
          <Stack.Screen name="LocationPicker">{({ navigation }) => <LocationPickerScreen ride={customerRide} initialTarget={locationTarget} onBack={() => navigation.goBack()} onChange={(target, place, coordinate) => setCustomerRide((ride) => ({ ...ride, [target]: place, ...(coordinate ? { [target === 'pickup' ? 'pickupCoordinate' : 'dropCoordinate']: coordinate } : {}) }))} onContinue={() => navigation.navigate('RideType')} />}</Stack.Screen>
          <Stack.Screen name="RideType">{({ navigation }) => <RideTypeScreen ride={customerRide} selected={customerRide.kind} onBack={() => navigation.goBack()} onSelect={(kind) => setCustomerRide((ride) => ({ ...ride, kind }))} onNext={() => navigation.navigate('BookingConfirm')} />}</Stack.Screen>
          <Stack.Screen name="BookingConfirm">{({ navigation }) => <BookingConfirmScreen ride={customerRide} onBack={() => navigation.goBack()} onBook={async (rideId) => { setCustomerRide((ride) => ({ ...ride, id: rideId })); navigation.navigate('Searching'); }} />}</Stack.Screen>
          <Stack.Screen name="Searching" options={{ animation: 'fade' }}>{({ navigation }) => <SearchingScreen rideId={customerRide.id} onBack={() => navigation.goBack()} onFound={() => navigation.replace('RideConfirmed')} onUnavailable={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
          <Stack.Screen name="RideConfirmed" options={{ animation: 'fade' }}>{({ navigation }) => <RideConfirmedScreen ride={customerRide} onHome={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerHome' }] })} />}</Stack.Screen>
        </> : mode === 'captain' ? <>
          {captainOnboardingComplete ? <Stack.Screen name="CaptainMain">{() => <CaptainMainStack online={captainOnline} onToggle={() => setCaptainOnline((online) => !online)} onLanguageChange={chooseLanguage} onTripComplete={() => setCaptainOnline(true)} />}</Stack.Screen> : <Stack.Screen name="CaptainOnboarding">{() => <CaptainOnboardingStack language={language} onLanguageChange={chooseLanguage} profile={captainProfile} onProfileChange={setCaptainProfile} onExit={onExit} submitted={Boolean(captainOnboardingSubmitted)} onSubmitted={submitCaptainOnboarding} onApproved={completeCaptainOnboarding} />}</Stack.Screen>}
        </> : null}
        <Stack.Screen name="Settings">{({ navigation, route }) => <SettingsScreen profile={Boolean((route.params as { profile?: boolean } | undefined)?.profile)} onBack={() => navigation.goBack()} onLanguageChange={(next) => { chooseLanguage(next).then(() => navigation.goBack()); }} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
    </GestureHandlerRootView>
  </I18nextProvider>;
}
