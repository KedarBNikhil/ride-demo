import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../../../i18n/createI18n';
import { LanguageToggle } from '../../../components/LanguageToggle';
import { PhoneOtpAuth } from '../../../components/PhoneOtpAuth';
import { captainOnboardingService } from '../../../services/captainOnboarding';
import { colors, fontFamily, fontSize } from '../../../theme';

export function CaptainSignUpScreen({ language, onLanguageChange, onComplete, onBack }: { language: AppLanguage; onLanguageChange: (language: AppLanguage) => void; onComplete: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  return <PhoneOtpAuth title={t('captain.signUpTitle')} subtitle={t('captain.signUpSubtitle')} emoji="🏍️" onBack={onBack} onSendOtp={captainOnboardingService.sendOtp} onVerifyOtp={async (phone, otp) => { await captainOnboardingService.verifyOtp(phone, otp); onComplete(); }}>
    <View style={styles.language}><Text style={styles.label}>{t('captain.appLanguage')}</Text><LanguageToggle value={language} onChange={onLanguageChange} /></View>
  </PhoneOtpAuth>;
}
const styles = StyleSheet.create({ language: { gap: 8 }, label: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' } });
