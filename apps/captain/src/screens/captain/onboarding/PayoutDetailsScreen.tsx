import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { ScreenShell } from '../../../components/ScreenShell';
import type { CaptainPayout } from '../../../services/captainOnboarding';
import { captainOnboardingService } from '../../../services/captainOnboarding';
import { colors, fontFamily, fontSize, radii, shadows } from '../../../theme';
import { normalizeAccountHolder, normalizeAccountNumber, normalizeIfsc, normalizeUpi, payoutFieldError, payoutIsValid, type PayoutField } from '../../../utils/payoutValidation';

export function PayoutDetailsScreen({ onBack, onFinish }: { onBack: () => void; onFinish: () => Promise<void> }) {
  const { t } = useTranslation();
  const [payout, setPayout] = useState<CaptainPayout>({ method: 'bank' });
  const [touched, setTouched] = useState<Partial<Record<PayoutField, boolean>>>({});
  const [saving, setSaving] = useState(false); const [submitError, setSubmitError] = useState('');
  const update = (next: Partial<CaptainPayout>) => { setPayout((value) => ({ ...value, ...next })); setSubmitError(''); };
  const errorFor = (field: PayoutField) => { if (payout.method === 'upi' && field !== 'upiId') return null; if (payout.method === 'bank' && field === 'upiId') return null; return touched[field] ? payoutFieldError(field, payout[field] ?? '', payout.accountNumber ?? '') : null; };
  const blur = (field: PayoutField) => setTouched((value) => ({ ...value, [field]: true }));
  const finish = async () => {
    setTouched(payout.method === 'bank' ? { accountNumber: true, confirmAccountNumber: true, ifsc: true, accountHolder: true } : { upiId: true });
    if (!payoutIsValid(payout.method, payout)) return;
    setSaving(true); setSubmitError('');
    try { await captainOnboardingService.savePayout(payout); await onFinish(); } catch (error) { setSubmitError(error instanceof Error ? error.message : t('captain.payoutRequired')); } finally { setSaving(false); }
  };
  const field = (label: string, key: PayoutField, placeholder: string, keyboardType?: 'number-pad') => {
    const value = payout[key as keyof CaptainPayout] ?? ''; const error = errorFor(key);
    const normalize = (raw: string) => key === 'accountNumber' || key === 'confirmAccountNumber' ? normalizeAccountNumber(raw) : key === 'ifsc' ? normalizeIfsc(raw) : key === 'accountHolder' ? normalizeAccountHolder(raw) : normalizeUpi(raw);
    return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={value} onChangeText={(raw) => update({ [key]: normalize(raw) })} onBlur={() => blur(key)} placeholder={placeholder} placeholderTextColor={colors.textMuted} style={[styles.input, error && styles.inputError]} autoCapitalize={key === 'ifsc' ? 'characters' : 'none'} keyboardType={keyboardType} autoCorrect={false} /><Text style={styles.fieldError}>{error ?? ' '}</Text></View>;
  };
  return <ScreenShell back={onBack} title={t('captain.payoutTitle')}><View style={styles.hero}><Text style={styles.emoji}>💰</Text><Text style={styles.help}>{t('captain.payoutSubtitle')}</Text></View><View style={[styles.card, shadows.soft]}><Text style={styles.label}>{t('captain.payoutMethod')}</Text><View style={styles.methods}>{(['bank', 'upi'] as const).map((method) => <Pressable key={method} onPress={() => { update({ method }); setTouched({}); }} style={[styles.method, payout.method === method && styles.active]}><Text style={[styles.methodText, payout.method === method && styles.activeText]}>{method === 'bank' ? t('captain.bankAccount') : t('captain.upiId')}</Text></Pressable>)}</View>{payout.method === 'bank' ? <>{field(t('captain.accountNumber'), 'accountNumber', '1234567890', 'number-pad')}{field('Confirm bank account number', 'confirmAccountNumber', 'Re-enter account number', 'number-pad')}{field(t('captain.ifscCode'), 'ifsc', 'SBIN0001234')}{field(t('captain.accountHolderName'), 'accountHolder', t('captain.fullNamePlaceholder'))}</> : field(t('captain.upiId'), 'upiId', 'name@bank')}</View>{submitError ? <Text style={styles.error}>{submitError}</Text> : null}<PrimaryButton label={saving ? t('login.pleaseWait') : t('captain.finishSetup')} onPress={() => { void finish(); }} disabled={saving || !payoutIsValid(payout.method, payout)} /></ScreenShell>;
}
const styles = StyleSheet.create({ hero: { alignItems: 'center', gap: 7 }, emoji: { fontSize: 45 }, help: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, textAlign: 'center' }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 5, padding: 18 }, label: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, methods: { flexDirection: 'row', gap: 8, marginBottom: 6 }, method: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, flex: 1, minHeight: 46, justifyContent: 'center', paddingHorizontal: 8 }, active: { backgroundColor: colors.primary, borderColor: colors.primary }, methodText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, activeText: { color: colors.textOnPrimary }, field: { gap: 0 }, input: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, fontFamily, fontSize: fontSize.md, padding: 13 }, inputError: { borderColor: colors.error }, fieldError: { color: colors.error, fontFamily, fontSize: fontSize.xs, minHeight: 17 }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' } });
