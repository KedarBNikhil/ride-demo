import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from './PrimaryButton';
import { ScreenShell } from './ScreenShell';
import { NumericCodeInput } from './NumericCodeInput';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';

type Props = {
  title: string;
  subtitle: string;
  emoji: string;
  onBack?: () => void;
  onSendOtp: (phone: string) => Promise<unknown>;
  onVerifyOtp: (phone: string, otp: string) => Promise<unknown>;
  children?: React.ReactNode;
};

/** Shared native phone and OTP entry used by both customer and captain flows. */
export function PhoneOtpAuth({ title, subtitle, emoji, onBack, onSendOtp, onVerifyOtp, children }: Props) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const value = step === 'phone' ? phone : otp;
  const limit = step === 'phone' ? 10 : 6;

  const submit = async () => {
    if (step === 'phone' && !/^\d{10}$/.test(phone)) return setError(t('login.invalidPhone'));
    if (step === 'otp' && !/^\d{6}$/.test(otp)) return setError(t('login.invalidOtp'));
    setError(''); setLoading(true);
    try {
      if (step === 'phone') { await onSendOtp(phone); setStep('otp'); }
      else await onVerifyOtp(phone, otp);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '';
      setError(
        message === 'DEMO_ANONYMOUS_SIGN_IN_DISABLED'
          ? t('login.demoSessionSetupRequired')
          : message === 'Invalid development OTP'
            ? t('login.demoOtpInvalid')
            : t('login.tryAgain'),
      );
    } finally { setLoading(false); }
  };

  return <ScreenShell back={onBack} title={step === 'phone' ? title : t('login.otpTitle')}>
    {children}
    <View style={styles.hero}><Text style={styles.emoji}>{emoji}</Text><Text style={styles.subtitle}>{step === 'phone' ? subtitle : t('login.otpSubtitle')}</Text></View>
    <View style={styles.card}><Text style={styles.label}>{step === 'phone' ? t('login.phoneLabel') : t('login.otpLabel')}</Text>
      {step === 'otp' ? <NumericCodeInput value={otp} length={limit} placeholder={t('login.otpPlaceholder')} onChangeText={(next) => { setOtp(next); setError(''); }} /> : <NumericCodeInput value={phone} length={limit} phone placeholder={t('login.phonePlaceholder')} onChangeText={(next) => { setPhone(next); setError(''); }} />}
    </View>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <PrimaryButton label={loading ? t('login.pleaseWait') : step === 'phone' ? t('login.sendOtp') : t('login.verify')} onPress={() => { void submit(); }} disabled={loading} />
  </ScreenShell>;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 10, paddingTop: 8 }, emoji: { fontSize: 48 }, subtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, lineHeight: 25, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 8, padding: 18, ...shadows.soft }, label: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' },
});
