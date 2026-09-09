import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AppLanguage } from '../i18n/createI18n';
import type { CaptainOnboardingRoute, CaptainProfile } from '../services/captainOnboarding';
import { captainOnboardingService } from '../services/captainOnboarding';
import { CaptainSignUpScreen } from '../screens/captain/onboarding/CaptainSignUpScreen';
import { CaptainProfileSetupScreen } from '../screens/captain/onboarding/CaptainProfileSetupScreen';
import { DocumentUploadScreen } from '../screens/captain/onboarding/DocumentUploadScreen';
import { PayoutDetailsScreen } from '../screens/captain/onboarding/PayoutDetailsScreen';
import { CaptainOnboardingReviewScreen } from '../screens/captain/onboarding/CaptainOnboardingReviewScreen';
const Stack = createNativeStackNavigator();
export function CaptainOnboardingStack({ language, onLanguageChange, profile, onProfileChange, onExit, onboardingRoute, onOtpVerified, onSubmitted, onApproved }: { language: AppLanguage; onLanguageChange: (language: AppLanguage) => void; profile: CaptainProfile; onProfileChange: (profile: CaptainProfile) => void; onExit: () => void; onboardingRoute: CaptainOnboardingRoute; onOtpVerified: () => Promise<void>; onSubmitted: () => Promise<void>; onApproved: () => Promise<void> }) {
  const initialRouteName = onboardingRoute === 'signup' ? 'CaptainSignUp' : onboardingRoute === 'profile' ? 'CaptainProfileSetup' : onboardingRoute === 'documents' ? 'DocumentUpload' : onboardingRoute === 'payout' ? 'PayoutDetails' : 'OnboardingReview';
  return <Stack.Navigator key={onboardingRoute} initialRouteName={initialRouteName} screenOptions={{ headerShown: false, animation: 'slide_from_right', animationDuration: 260 }}><Stack.Screen name="CaptainSignUp">{({ navigation }) => <CaptainSignUpScreen language={language} onLanguageChange={onLanguageChange} onComplete={onOtpVerified} />}</Stack.Screen><Stack.Screen name="CaptainProfileSetup">{({ navigation }) => <CaptainProfileSetupScreen profile={profile} onChange={onProfileChange} onBack={() => navigation.goBack()} onContinue={() => { void captainOnboardingService.saveProfile(profile).then(() => navigation.navigate('DocumentUpload')); }} />}</Stack.Screen><Stack.Screen name="DocumentUpload">{({ navigation }) => <DocumentUploadScreen onBack={() => navigation.goBack()} onComplete={() => navigation.navigate('PayoutDetails')} />}</Stack.Screen><Stack.Screen name="PayoutDetails" options={{ animation: 'fade' }}>{({ navigation }) => <PayoutDetailsScreen onBack={() => navigation.goBack()} onFinish={async () => { await onSubmitted(); navigation.reset({ index: 0, routes: [{ name: 'OnboardingReview' }] }); }} />}</Stack.Screen><Stack.Screen name="OnboardingReview" options={{ animation: 'fade' }}>{() => <CaptainOnboardingReviewScreen onExit={onExit} onRefresh={captainOnboardingService.getReviewStatus} onApproved={onApproved} />}</Stack.Screen></Stack.Navigator>;
}
