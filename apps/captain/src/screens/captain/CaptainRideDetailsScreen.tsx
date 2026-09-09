import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ScreenShell } from '../../components/ScreenShell';
import { formatFare, formatNumber } from '../../utils/format';
import { rideDispatchService, type CaptainRideDetails } from '../../services/rideDispatch';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';
import { CaptainPaymentIssueFlow } from './CaptainPaymentIssueFlow';
import { legalOperator } from '../../legal/legalDocuments';

const paymentIssueLabelKeys = {
  customer_did_not_pay: 'captain.paymentIssueCustomerDidNotPay',
  payment_method_mismatch: 'captain.paymentIssueMethodMismatch',
  upi_not_received: 'captain.paymentIssueUpiNotReceived',
  cash_not_received: 'captain.paymentIssueCashNotReceived',
  other: 'captain.paymentIssueOther',
} as const;

export function CaptainRideDetailsScreen({ rideId, onBack, onOpenSupportChat }: { rideId: string; onBack: () => void; onOpenSupportChat: () => void }) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<CaptainRideDetails | null>(null); const [failed, setFailed] = useState(false); const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => { setDetails(null); setFailed(false); void rideDispatchService.getCaptainRideDetails(rideId).then(setDetails).catch(() => setFailed(true)); }, [rideId]);
  const ride = details?.ride;
  const duration = useMemo(() => ride?.started_at && ride.completed_at ? Math.max(0, Math.floor((new Date(ride.completed_at).getTime() - new Date(ride.started_at).getTime()) / 1000)) : null, [ride]);
  const paymentMode = ride?.payment_method === 'cash' ? t('captain.paymentCash') : ride?.payment_method === 'upi' ? t('captain.paymentUpi') : '—';
  const actualFare = ride?.final_fare ?? ride?.estimated_fare;
  const issueAvailable = ride?.status === 'completed' && ride.customer_charge_type === 'standard' && ride.payment_status === 'pending';
  return <ScreenShell back={onBack} title={t('captain.rideDetailsTitle')}>
    {failed && <Text accessibilityRole="alert" style={styles.error}>{t('captain.rideDetailsUnavailable')}</Text>}
    {!details && !failed && <Text style={styles.loading}>{t('login.pleaseWait')}</Text>}
    {details && <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Section title={t('captain.customerDetails')}><Row label={t('captain.customerName')} value={details.customerName || '—'} /><Row label={t('rides.pickup')} value={ride!.pickup_address || '—'} /><Row label={t('rides.drop')} value={ride!.drop_address || '—'} /></Section>
      <Section title={t('captain.tripDetails')}><Row label={t('captain.totalDistance')} value={ride!.travelled_distance_km == null ? '—' : `${formatNumber(Number(ride!.travelled_distance_km), { maximumFractionDigits: 1 })} km`} /><Row label={t('captain.totalDuration')} value={duration == null ? '—' : `${formatNumber(Math.floor(duration / 60))}:${formatNumber(duration % 60).padStart(2, '0')}`} /><Row label={t('captain.paymentMode')} value={paymentMode} /></Section>
      <Section title={t('captain.fareBreakdown')}><Row label={t('captain.actualRideFare')} value={actualFare == null ? '—' : formatFare(Number(actualFare))} /><Row label={t('captain.tipsReceived')} value="—" /><Row label={t('captain.bonusReceived')} value="—" /><Row label={t('captain.earningForRide')} value={details.payout ? formatFare(details.payout.captain_earning_amount) : '—'} total /></Section>
      {details.paymentIssue && <Section title={t('captain.paymentIssueDetails')}><Row label={t('captain.paymentIssueTitle')} value={t(paymentIssueLabelKeys[details.paymentIssue.reason])} /><Row label={t('captain.paymentIssueStatus')} value={details.paymentIssue.status === 'open' ? t('captain.paymentIssueOpen') : t('captain.paymentIssueResolved')} /><Pressable accessibilityRole="button" onPress={() => setHelpOpen((open) => !open)} style={styles.helpButton}><Text style={styles.helpButtonText}>{t('captain.paymentIssueHelp')}</Text></Pressable>{helpOpen && <View style={styles.helpActions}><Pressable accessibilityRole="button" onPress={onOpenSupportChat} style={styles.supportAction}><Text style={styles.supportActionText}>{t('captain.supportChatAction')}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { void Linking.openURL(`tel:${legalOperator.phone}`); }} style={styles.supportAction}><Text style={styles.supportActionText}>{t('captain.supportCallAction')}</Text></Pressable></View>}</Section>}
      <Text style={styles.note}>{t('captain.tipsBonusUnavailable')}</Text>
      <CaptainPaymentIssueFlow rideId={rideId} available={issueAvailable} />
    </ScrollView>}
  </ScreenShell>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <View style={[styles.section, shadows.card]}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>; }
function Row({ label, value, total = false }: { label: string; value: string; total?: boolean }) { return <View style={styles.row}><Text style={[styles.label, total && styles.totalLabel]}>{label}</Text><Text style={[styles.value, total && styles.totalValue]}>{value}</Text></View>; }
const styles = StyleSheet.create({ content: { gap: 12, paddingBottom: 20 }, loading: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, textAlign: 'center' }, error: { color: colors.error, fontFamily, fontSize: fontSize.md, fontWeight: '700', textAlign: 'center' }, section: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 12, padding: 16 }, sectionTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, row: { gap: 4 }, label: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, value: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, totalLabel: { color: colors.textPrimary, fontWeight: '900' }, totalValue: { color: colors.primary, fontSize: fontSize.lg, fontWeight: '900' }, helpButton: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.md, minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }, helpButtonText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900' }, helpActions: { gap: 8 }, supportAction: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, minHeight: 42, justifyContent: 'center', paddingHorizontal: 12 }, supportActionText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900' }, note: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, lineHeight: 18, textAlign: 'center' } });
