import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { createAppI18n, type AppLanguage } from '../i18n/createI18n';
import { LanguageSelectScreen } from '../screens/LanguageSelectScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { BookingConfirmScreen, CustomerHomeScreen, CustomerLoginScreen, type CustomerRide, LocationPickerScreen, RideConfirmedScreen, RideTypeScreen, SearchingScreen } from '../screens/CustomerScreens';
import { CaptainHomeScreen, CaptainLoginScreen, IncomingRequestScreen, RideInProgressScreen, RideSummaryScreen } from '../screens/CaptainScreens';

export type AppMode = 'customer' | 'captain';
const Stack = createNativeStackNavigator();

export function AppNavigator({ mode, onExit }: { mode: AppMode; onExit: () => void }) {
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasLanguage, setHasLanguage] = useState<boolean | null>(null);
  const [i18n] = useState(() => createAppI18n('en'));
  const [customerRide, setCustomerRide] = useState<CustomerRide>({ pickup: '', drop: '', kind: 'bike' });
  const [locationTarget, setLocationTarget] = useState<'pickup' | 'drop'>('pickup');
  const [captainOnline, setCaptainOnline] = useState(false);
  const storageKey = `nandyal-ride-demo.${mode}.language`;

  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (saved === 'en' || saved === 'te') { setLanguage(saved); i18n.changeLanguage(saved); setHasLanguage(true); }
      else setHasLanguage(false);
    });
  }, [i18n, storageKey]);

  const chooseLanguage = async (next: AppLanguage) => {
    setLanguage(next);
    await i18n.changeLanguage(next);
    await AsyncStorage.setItem(storageKey, next);
    setHasLanguage(true);
  };

  if (hasLanguage === null) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  return <I18nextProvider i18n={i18n}>
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!hasLanguage && <Stack.Screen name="LanguageSelect">{() => <LanguageSelectScreen onChoose={chooseLanguage} />}</Stack.Screen>}
        {mode === 'customer' ? <>
          <Stack.Screen name="CustomerLogin">{({ navigation }) => <CustomerLoginScreen onComplete={() => navigation.navigate('CustomerHome')} onBack={onExit} />}</Stack.Screen>
          <Stack.Screen name="CustomerHome">{({ navigation }) => <CustomerHomeScreen ride={customerRide} onBack={onExit} onSettings={() => navigation.navigate('Settings')} onPickLocation={(target) => { setLocationTarget(target); navigation.navigate('LocationPicker'); }} onChooseRide={() => navigation.navigate('RideType')} />}</Stack.Screen>
          <Stack.Screen name="LocationPicker">{({ navigation }) => <LocationPickerScreen target={locationTarget} onBack={() => navigation.goBack()} onSelect={(place) => { setCustomerRide((ride) => ({ ...ride, [locationTarget]: place })); navigation.goBack(); }} />}</Stack.Screen>
          <Stack.Screen name="RideType">{({ navigation }) => <RideTypeScreen selected={customerRide.kind} onBack={() => navigation.goBack()} onSelect={(kind) => setCustomerRide((ride) => ({ ...ride, kind }))} onNext={() => navigation.navigate('BookingConfirm')} />}</Stack.Screen>
          <Stack.Screen name="BookingConfirm">{({ navigation }) => <BookingConfirmScreen ride={customerRide} onBack={() => navigation.goBack()} onBook={() => navigation.navigate('Searching')} />}</Stack.Screen>
          <Stack.Screen name="Searching">{({ navigation }) => <SearchingScreen onBack={() => navigation.goBack()} onFound={() => navigation.replace('RideConfirmed')} />}</Stack.Screen>
          <Stack.Screen name="RideConfirmed">{({ navigation }) => <RideConfirmedScreen onHome={() => navigation.popToTop()} />}</Stack.Screen>
        </> : mode === 'captain' ? <>
          <Stack.Screen name="CaptainLogin">{({ navigation }) => <CaptainLoginScreen onComplete={() => navigation.navigate('CaptainHome')} onBack={onExit} />}</Stack.Screen>
          <Stack.Screen name="CaptainHome">{({ navigation }) => <CaptainHomeScreen online={captainOnline} onToggle={() => setCaptainOnline((online) => !online)} onSettings={() => navigation.navigate('Settings')} onRequest={() => navigation.navigate('IncomingRequest')} />}</Stack.Screen>
          <Stack.Screen name="IncomingRequest">{({ navigation }) => <IncomingRequestScreen onBack={() => navigation.goBack()} onDecline={() => navigation.goBack()} onAccept={() => navigation.replace('RideInProgress')} />}</Stack.Screen>
          <Stack.Screen name="RideInProgress">{({ navigation }) => <RideInProgressScreen onBack={() => navigation.navigate('CaptainHome')} onComplete={() => navigation.replace('RideSummary')} />}</Stack.Screen>
          <Stack.Screen name="RideSummary">{({ navigation }) => <RideSummaryScreen onHome={() => navigation.navigate('CaptainHome')} />}</Stack.Screen>
        </> : null}
        <Stack.Screen name="Settings">{({ navigation }) => <SettingsScreen onBack={() => navigation.goBack()} onLanguageChange={(next) => { chooseLanguage(next).then(() => navigation.goBack()); }} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  </I18nextProvider>;
}
