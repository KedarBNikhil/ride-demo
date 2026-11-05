import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from './PrimaryButton';
import { ScreenShell } from './ScreenShell';
import { NumericCodeInput } from './NumericCodeInput';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';
import { toIndianE164 } from '../services/authMode';

// Supabase Auth's configured SMS OTP lifetime for this Customer flow.
const SMS_OTP_EXPIRY_SECONDS = 60;

type Props = {
  title: string;
  subtitle: string;
  emoji: string;
  onBack?: () => void;
  onSendOtp: (phone: string) => Promise<unknown>;
  onVerifyOtp: (phone: string, otp: string) => Promise<unknown>;
  initialPhone?: string;
  phoneStepContent?: React.ReactNode;
  phoneStepLabel?: string;
  canSendOtp?: boolean;
  children?: React.ReactNode;
  customerLoginLayout?: boolean;
  customerSignupLayout?: boolean;
  languageLabel?: string;
  onLanguagePress?: () => void;
};

/** Shared native phone and OTP entry used by both customer and captain flows. */
export function PhoneOtpAuth({ title, subtitle, emoji, onBack, onSendOtp, onVerifyOtp, initialPhone = '', phoneStepContent, phoneStepLabel, canSendOtp = true, children, customerLoginLayout = false, customerSignupLayout = false, languageLabel, onLanguagePress }: Props) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState(initialPhone);
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpExpiresIn, setOtpExpiresIn] = useState(0);
  const phoneIsValid = () => {
    try { toIndianE164(phone); return true; } catch { return false; }
  };

  useEffect(() => {
    if (step === 'phone') setPhone(initialPhone);
  }, [initialPhone, step]);

  useEffect(() => {
    if (step !== 'otp' || otpExpiresIn <= 0) return;
    const timer = setInterval(() => setOtpExpiresIn((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [otpExpiresIn, step]);

  const displayedPhone = () => {
    try { return toIndianE164(phone); } catch { return phone; }
  };

  const formattedOtpTime = () => `${String(Math.floor(otpExpiresIn / 60)).padStart(2, '0')}:${String(otpExpiresIn % 60).padStart(2, '0')}`;

  const submit = async () => {
    if (step === 'phone' && !phoneIsValid()) return setError(t('login.invalidPhone'));
    if (step === 'otp' && !/^\d{6}$/.test(otp)) return setError(t('login.invalidOtp'));
    setError(''); setLoading(true);
    try {
      if (step === 'phone') {
        const result = await onSendOtp(phone);
        if (result !== false) {
          setOtp('');
          setOtpExpiresIn(SMS_OTP_EXPIRY_SECONDS);
          setStep('otp');
        }
      }
      else await onVerifyOtp(phone, otp);
    } catch (caught) {
      setError(t('login.tryAgain'));
    } finally { setLoading(false); }
  };

  const resendOtp = async () => {
    if (otpExpiresIn > 0 || loading) return;
    setError('');
    setLoading(true);
    try {
      const result = await onSendOtp(phone);
      if (result !== false) {
        setOtp('');
        setOtpExpiresIn(SMS_OTP_EXPIRY_SECONDS);
      }
    } catch (caught) {
      setError(t('login.tryAgain'));
    } finally {
      setLoading(false);
    }
  };

  if ((customerLoginLayout || customerSignupLayout) && step === 'phone') {
    return <SafeAreaView style={styles.customerLoginSafe} edges={['top', 'right', 'bottom', 'left']}>
      <View style={styles.customerLoginRoot}>
        <View style={styles.customerLoginHeader}>
          <View style={styles.customerLoginHeaderLeft}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={onBack} hitSlop={12} style={styles.customerLoginBack}>
              <Text style={styles.customerLoginBackIcon}>‹</Text>
            </Pressable>
            <Text style={styles.customerLoginBrand}>Sawaari</Text>
          </View>
          {onLanguagePress && <Pressable accessibilityRole="button" accessibilityLabel={t('language.change')} onPress={onLanguagePress} style={styles.customerLoginLanguageButton}>
            <Text style={styles.customerLoginLanguageLabel}>{languageLabel}</Text>
          </Pressable>}
        </View>
        <View style={styles.customerLoginContent}>
          <Text style={styles.customerLoginTitle}>{title}</Text>
          <Text style={styles.customerLoginSubtitle}>{subtitle}</Text>
          {customerSignupLayout ? phoneStepContent : <>
            <Text style={styles.customerLoginLabel}>{t('login.customerPhoneLabel')}<Text style={styles.customerLoginRequired}>*</Text></Text>
            <View style={styles.customerLoginPhoneRow}>
              <View accessibilityLabel="Country code +91" style={styles.customerLoginCountryCode}><Text style={styles.customerLoginCountryCodeText}>+91</Text></View>
              <TextInput
                accessibilityLabel="Phone number"
                autoFocus
                keyboardType="phone-pad"
                maxLength={10}
                onChangeText={(next) => { setPhone(next.replace(/\D/g, '').slice(0, 10)); setError(''); }}
                selectionColor={colors.primary}
                style={styles.customerLoginPhoneInput}
                value={phone.replace(/^\+91/, '')}
              />
            </View>
          </>}
          {!!error && <Text style={styles.customerLoginError}>{error}</Text>}
        </View>
        <View style={styles.customerLoginFooter}>
          <PrimaryButton label={loading ? t('login.pleaseWait') : t('login.sendOtp')} onPress={() => { void submit(); }} disabled={loading || !phoneIsValid() || !canSendOtp} />
        </View>
      </View>
    </SafeAreaView>;
  }

  if ((customerLoginLayout || customerSignupLayout) && step === 'otp') {
    return <SafeAreaView style={styles.customerLoginSafe} edges={['top', 'right', 'bottom', 'left']}>
      <View style={styles.customerLoginRoot}>
        <View style={styles.customerLoginHeader}>
          <View style={styles.customerLoginHeaderLeft}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={() => { setStep('phone'); setOtp(''); setError(''); }} hitSlop={12} style={styles.customerLoginBack}>
              <Text style={styles.customerLoginBackIcon}>‹</Text>
            </Pressable>
            <Text style={styles.customerLoginBrand}>Sawaari</Text>
          </View>
          <View style={styles.customerOtpHeaderSpacer} />
        </View>
        <View style={styles.customerLoginContent}>
          <Text style={styles.customerLoginTitle}>{t('login.otpScreenTitle')}</Text>
          <Text style={styles.customerLoginSubtitle}>{t('login.otpSentTo', { phone: displayedPhone() })}</Text>
          <Text style={styles.customerLoginLabel}>{t('login.otpLabel')}<Text style={styles.customerLoginRequired}>*</Text></Text>
          <View style={styles.customerOtpField}>
            <TextInput
              accessibilityLabel={t('login.otpLabel')}
              autoFocus
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={(next) => { setOtp(next.replace(/\D/g, '').slice(0, 6)); setError(''); }}
              placeholder="•  •  •  •  •  •"
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.primary}
              style={styles.customerOtpInput}
              value={otp}
            />
            <Text style={styles.customerOtpTimer}>{formattedOtpTime()}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: otpExpiresIn > 0 || loading }}
            disabled={otpExpiresIn > 0 || loading}
            onPress={() => { void resendOtp(); }}
            style={[styles.customerResendButton, (otpExpiresIn > 0 || loading) && styles.customerResendButtonDisabled]}
          >
            <Text style={[styles.customerResendText, (otpExpiresIn > 0 || loading) && styles.customerResendTextDisabled]}>{loading ? t('login.pleaseWait') : t('login.resendOtp')}</Text>
          </Pressable>
          {!!error && <Text style={styles.customerLoginError}>{error}</Text>}
        </View>
        <View style={styles.customerLoginFooter}>
          <PrimaryButton label={loading ? t('login.pleaseWait') : t('login.verify')} onPress={() => { void submit(); }} disabled={loading || otpExpiresIn === 0 || !/^\d{6}$/.test(otp)} />
        </View>
      </View>
    </SafeAreaView>;
  }

  return <ScreenShell back={onBack} title={step === 'phone' ? title : t('login.otpTitle')}>
    {step === 'phone' && children}
    <View style={styles.hero}>{emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}<Text style={styles.subtitle}>{step === 'phone' ? subtitle : t('login.otpSubtitle')}</Text></View>
    <View style={styles.card}>{(step === 'phone' ? phoneStepLabel ?? t('login.phoneLabel') : t('login.otpLabel')) ? <Text style={styles.label}>{step === 'phone' ? phoneStepLabel ?? t('login.phoneLabel') : t('login.otpLabel')}</Text> : null}
      {step === 'otp' ? <NumericCodeInput value={otp} length={6} placeholder={t('login.otpPlaceholder')} onChangeText={(next) => { setOtp(next); setError(''); }} /> : phoneStepContent ?? <NumericCodeInput value={phone} length={13} phone placeholder={t('login.phonePlaceholder')} onChangeText={(next) => { setPhone(next); setError(''); }} />}
    </View>
    {!!error && <Text style={styles.error}>{error}</Text>}
    <PrimaryButton label={loading ? t('login.pleaseWait') : step === 'phone' ? t('login.sendOtp') : t('login.verify')} onPress={() => { void submit(); }} disabled={loading || (step === 'phone' && (!phoneIsValid() || !canSendOtp))} />
  </ScreenShell>;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 10, paddingTop: 8 }, emoji: { fontSize: 48 }, subtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, lineHeight: 25, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 8, padding: 18, ...shadows.soft }, label: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' },
  customerLoginSafe: { backgroundColor: colors.surface, flex: 1 },
  customerLoginRoot: { flex: 1 },
  customerLoginHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 70, paddingHorizontal: 24 },
  customerLoginHeaderLeft: { alignItems: 'center', flexDirection: 'row', gap: 4, marginLeft: -12 },
  customerLoginBack: { alignItems: 'center', height: 44, justifyContent: 'center', width: 32 },
  customerLoginBackIcon: { color: colors.textPrimary, fontFamily: 'System', fontSize: 42, fontWeight: '300', lineHeight: 42, marginTop: -4 },
  customerLoginBrand: { color: colors.primary, fontFamily: 'NotoSansTelugu-ExtraBold', fontSize: fontSize['3xl'], letterSpacing: -1.4 },
  customerLoginLanguageButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  customerLoginLanguageLabel: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  customerLoginContent: { paddingHorizontal: 28, paddingTop: 34 },
  customerLoginTitle: { color: colors.textPrimary, fontFamily: 'NotoSansTelugu-ExtraBold', fontSize: 32, letterSpacing: -0.9 },
  customerLoginSubtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.lg, lineHeight: 28, marginTop: 12, maxWidth: 340 },
  customerLoginLabel: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800', marginTop: 48 },
  customerLoginRequired: { color: colors.error },
  customerLoginPhoneRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 16, marginTop: 18 },
  customerLoginCountryCode: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, height: 46, justifyContent: 'center', paddingHorizontal: 16 },
  customerLoginCountryCodeText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  customerLoginPhoneInput: { borderBottomColor: colors.border, borderBottomWidth: 2, color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.xl, fontWeight: '700', height: 52, paddingHorizontal: 0, paddingVertical: 0 },
  customerLoginError: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '700', marginTop: 12 },
  customerLoginFooter: { marginTop: 'auto', paddingBottom: 18, paddingHorizontal: 28 },
  customerOtpField: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: 2, flexDirection: 'row', marginTop: 18 },
  customerOtpInput: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.xl, fontWeight: '700', height: 52, letterSpacing: 4, paddingHorizontal: 0, paddingVertical: 0 },
  customerOtpTimer: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900', paddingBottom: 3 },
  customerOtpHeaderSpacer: { height: 56, width: 56 },
  customerResendButton: { alignSelf: 'flex-start', borderColor: colors.primary, borderRadius: radii.pill, borderWidth: 1, marginTop: 16, paddingHorizontal: 18, paddingVertical: 10 },
  customerResendButtonDisabled: { borderColor: colors.border },
  customerResendText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900' },
  customerResendTextDisabled: { color: colors.textMuted },
});
