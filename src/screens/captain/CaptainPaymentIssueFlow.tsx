import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../../components/PrimaryButton';
import { rideDispatchService } from '../../services/rideDispatch';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';

const paymentIssueReasons = ['customer_did_not_pay', 'payment_method_mismatch', 'upi_not_received', 'cash_not_received', 'other'] as const;
type PaymentIssueReason = typeof paymentIssueReasons[number];
const paymentIssueLabelKeys: Record<PaymentIssueReason, string> = {
  customer_did_not_pay: 'captain.paymentIssueCustomerDidNotPay',
  payment_method_mismatch: 'captain.paymentIssueMethodMismatch',
  upi_not_received: 'captain.paymentIssueUpiNotReceived',
  cash_not_received: 'captain.paymentIssueCashNotReceived',
  other: 'captain.paymentIssueOther',
};

export function CaptainPaymentIssueFlow({ rideId, available }: { rideId: string; available: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false); const [saving, setSaving] = useState(false); const [reason, setReason] = useState<PaymentIssueReason | null>(null); const [noted, setNoted] = useState(false); const [error, setError] = useState('');
  const submit = async () => { if (!reason) return setError(t('captain.paymentIssueRequired')); setSaving(true); setError(''); try { await rideDispatchService.raiseCaptainPaymentIssue(rideId, reason); setNoted(true); setOpen(false); } catch { setError(t('captain.paymentIssueSaveFailed')); } finally { setSaving(false); } };
  return <View style={styles.container}>
    {!noted && !open && <PrimaryButton label={t('captain.raisePaymentIssue')} onPress={() => { setOpen(true); setError(''); }} disabled={!available || saving} />}
    {!available && !noted && <Text style={styles.unavailable}>{t('captain.paymentIssueUnavailable')}</Text>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {open && <View style={[styles.issueCard, shadows.soft]}><Text style={styles.issueTitle}>{t('captain.paymentIssueTitle')}</Text>{paymentIssueReasons.map((option) => <Pressable key={option} onPress={() => { setReason(option); setError(''); }} accessibilityRole="radio" accessibilityState={{ selected: reason === option }} style={[styles.issueOption, reason === option && styles.issueOptionSelected]}><Text style={styles.issueRadio}>{reason === option ? '◉' : '○'}</Text><Text style={styles.issueOptionText}>{t(paymentIssueLabelKeys[option])}</Text></Pressable>)}<PrimaryButton label={saving ? t('login.pleaseWait') : t('captain.submitPaymentIssue')} onPress={() => { void submit(); }} disabled={saving} /></View>}
    {noted && <Text style={styles.noted}>{t('captain.paymentIssueNoted')}</Text>}
  </View>;
}

const styles = StyleSheet.create({ container: { gap: 10 }, unavailable: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, textAlign: 'center' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' }, issueCard: { backgroundColor: colors.surface, borderColor: colors.accent, borderRadius: radii.lg, borderWidth: 1, gap: 10, padding: 14 }, issueTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, issueOption: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 44, paddingHorizontal: 11 }, issueOptionSelected: { backgroundColor: colors.accentLight, borderColor: colors.accent }, issueRadio: { color: colors.accent, fontSize: 20 }, issueOptionText: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.sm, fontWeight: '700' }, noted: { color: colors.success, fontFamily, fontSize: fontSize.sm, fontWeight: '700', lineHeight: 20, textAlign: 'center' } });
