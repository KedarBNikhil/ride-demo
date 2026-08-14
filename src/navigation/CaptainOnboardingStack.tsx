import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AppLanguage } from '../i18n/createI18n';
import type { CaptainProfile } from '../services/captainOnboarding';
import { captainOnboardingService } from '../services/captainOnboarding';
import { CaptainSignUpScreen } from '../screens/captain/onboarding/CaptainSignUpScreen';
import { CaptainProfileSetupScreen } from '../screens/captain/onboarding/CaptainProfileSetupScreen';
import { DocumentUploadScreen } from '../screens/captain/onboarding/DocumentUploadScreen';
import { PayoutDetailsScreen } from '../screens/captain/onboarding/PayoutDetailsScreen';
const Stack = createNativeStackNavigator();
export function CaptainOnboardingStack({ language, onLanguageChange, profile, onProfileChange, onExit, onComplete }: { language: AppLanguage; onLanguageChange: (language: AppLanguage) => void; profile: CaptainProfile; onProfileChange: (profile: CaptainProfile) => void; onExit: () => void; onComplete: () => Promise<void> }) { return <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 260 }}><Stack.Screen name="CaptainSignUp">{({ navigation }) => <CaptainSignUpScreen language={language} onLanguageChange={onLanguageChange} onBack={onExit} onComplete={() => { onProfileChange({ ...profile, language }); navigation.navigate('CaptainProfileSetup'); }} />}</Stack.Screen><Stack.Screen name="CaptainProfileSetup">{({ navigation }) => <CaptainProfileSetupScreen profile={profile} onChange={onProfileChange} onBack={() => navigation.goBack()} onContinue={() => { void captainOnboardingService.saveProfile(profile).then(() => navigation.navigate('DocumentUpload')); }} />}</Stack.Screen><Stack.Screen name="DocumentUpload">{({ navigation }) => <DocumentUploadScreen onBack={() => navigation.goBack()} onComplete={() => navigation.navigate('PayoutDetails')} />}</Stack.Screen><Stack.Screen name="PayoutDetails" options={{ animation: 'fade' }}>{({ navigation }) => <PayoutDetailsScreen onBack={() => navigation.goBack()} onFinish={onComplete} />}</Stack.Screen></Stack.Navigator>; }
