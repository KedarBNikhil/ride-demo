import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DialogProvider } from '../components/ThemedDialog';
import { createAppI18n, type AppLanguage } from '../i18n/createI18n';
import { CaptainMainStack } from './CaptainMainStack';
import { CaptainOnboardingStack } from './CaptainOnboardingStack';
import type { CaptainAccountStatus, CaptainOnboardingRoute, CaptainProfile } from '../services/captainOnboarding';
import { captainOnboardingService } from '../services/captainOnboarding';
import { configurePushNotifications, registerPushNotifications } from '../services/pushNotifications';
import { rideDispatchService } from '../services/rideDispatch';
import { supabase } from '../lib/supabase';

const Stack = createNativeStackNavigator();

export function CaptainAppNavigator() {
  const [language, setLanguage] = useState<AppLanguage>('en');
  const [hasLanguage, setHasLanguage] = useState<boolean | null>(null);
  const [i18n] = useState(() => createAppI18n('en'));
  const [captainOnline, setCaptainOnline] = useState(false);
  const [profile, setProfile] = useState<CaptainProfile>({ name: '', language: 'en', vehicleType: null });
  const [accountStatus, setAccountStatus] = useState<CaptainAccountStatus>('unauthenticated');
  const [onboardingRoute, setOnboardingRoute] = useState<CaptainOnboardingRoute>('signup');
  const [accountReady, setAccountReady] = useState(false);

  useEffect(() => { configurePushNotifications(); }, []);
  useEffect(() => {
    AsyncStorage.getItem('sawaari.captain.language').then((saved) => {
      if (saved === 'en' || saved === 'te') { setLanguage(saved); void i18n.changeLanguage(saved); setHasLanguage(true); }
      else setHasLanguage(false);
    });
  }, [i18n]);
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const register = (hasSession: boolean) => { if (mounted && hasSession) void registerPushNotifications('captain').catch(() => undefined); };
    void supabase.auth.getSession().then(({ data: { session } }) => register(Boolean(session)));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => register(Boolean(session)));
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    let mounted = true;
    const resolve = async () => {
      try {
        const account = await captainOnboardingService.resolveAuthenticatedAccount();
        if (!mounted) return;
        setProfile(account.profile); setAccountStatus(account.status); setOnboardingRoute(account.onboardingRoute);
      } catch {
        if (mounted) { setAccountStatus('unauthenticated'); setOnboardingRoute('signup'); }
      } finally { if (mounted) setAccountReady(true); }
    };
    void resolve();
    if (!supabase) return () => { mounted = false; };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (!session || event === 'SIGNED_OUT') { setAccountStatus('unauthenticated'); setOnboardingRoute('signup'); setAccountReady(true); return; }
      setAccountReady(false); void resolve();
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (accountStatus === 'approved') void rideDispatchService.getCaptainAvailability().then(setCaptainOnline).catch(() => setCaptainOnline(false));
  }, [accountStatus]);
  const chooseLanguage = async (next: AppLanguage) => { setLanguage(next); await i18n.changeLanguage(next); await AsyncStorage.setItem('sawaari.captain.language', next); setHasLanguage(true); };
  if (hasLanguage === null || !accountReady) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  return <I18nextProvider i18n={i18n}><DialogProvider><GestureHandlerRootView style={{ flex: 1 }}><NavigationContainer>
    <Stack.Navigator key={accountStatus} screenOptions={{ headerShown: false }}>
      {accountStatus === 'approved'
        ? <Stack.Screen name="CaptainMain">{() => <CaptainMainStack online={captainOnline} onToggle={() => setCaptainOnline((online) => !online)} onLanguageChange={chooseLanguage} onTripComplete={() => setCaptainOnline(true)} onAccountDeleted={() => { setCaptainOnline(false); setAccountStatus('unauthenticated'); setOnboardingRoute('signup'); }} />}</Stack.Screen>
        : <Stack.Screen name="CaptainOnboarding">{() => <CaptainOnboardingStack language={language} onLanguageChange={(next) => { void chooseLanguage(next); }} profile={profile} onProfileChange={setProfile} onExit={() => undefined} onboardingRoute={accountStatus === 'unauthenticated' ? 'signup' : onboardingRoute} onOtpVerified={async () => { setAccountReady(false); const account = await captainOnboardingService.resolveAuthenticatedAccount(); setProfile(account.profile); setAccountStatus(account.status); setOnboardingRoute(account.onboardingRoute); setAccountReady(true); }} onSubmitted={async () => { setOnboardingRoute('review'); setAccountStatus('submitted'); }} onApproved={async () => { const account = await captainOnboardingService.resolveAuthenticatedAccount(); setProfile(account.profile); setAccountStatus(account.status); setOnboardingRoute(account.onboardingRoute); }} />}</Stack.Screen>}
    </Stack.Navigator>
  </NavigationContainer></GestureHandlerRootView></DialogProvider></I18nextProvider>;
}
