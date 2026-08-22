import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenShell } from '../../components/ScreenShell';
import { formatFare, formatNumber } from '../../utils/format';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';
import { rideDispatchService, type CaptainRidePayout, type DispatchRide } from '../../services/rideDispatch';
import { CaptainPaymentIssueFlow } from './CaptainPaymentIssueFlow';

export function EndRideScreen({ rideId, onConfirmed }: { rideId: string; onConfirmed: () => void }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false); const [ride, setRide] = useState<DispatchRide | null>(null); const [payout, setPayout] = useState<CaptainRidePayout | null>(null); const [error, setError] = useState('');
  const refresh = useCallback(async () => { const [nextRide, nextPayout] = await Promise.all([rideDispatchService.getRide(rideId), rideDispatchService.getCaptainRidePayout(rideId)]); setRide(nextRide); setPayout(nextPayout); return nextRide; }, [rideId]);
  useEffect(() => { void refresh().catch(() => setRide(null)); }, [refresh]);
  const durationSeconds = ride?.started_at && ride?.completed_at ? Math.max(0, Math.floor((new Date(ride.completed_at).getTime() - new Date(ride.started_at).getTime()) / 1000)) : null;
  const duration = durationSeconds == null ? '—' : `${formatNumber(Math.floor(durationSeconds / 60))}:${formatNumber(durationSeconds % 60).padStart(2, '0')}`;
  const baseFare = Number(ride?.base_fare ?? ride?.estimated_fare ?? 0); const adjustment = Number(ride?.distance_surcharge ?? 0) + Number(ride?.pickup_surcharge ?? 0); const total = Number(payout?.captain_earning_amount ?? ride?.final_fare ?? ride?.estimated_fare ?? 0);
  const isFreeRide = ride?.customer_charge_type === 'free' && Number(ride.customer_charge_amount ?? 0) === 0;
  const hasDeclaredPayment = ride?.customer_charge_type === 'standard' && ride.payment_status === 'declared' && (ride.payment_method === 'cash' || ride.payment_method === 'upi');
  const paymentConfirmed = ride?.customer_charge_type === 'standard' && ride.payment_status === 'confirmed';
  const needsPaymentIssue = ride?.customer_charge_type === 'standard' && !paymentConfirmed;
  const continueAfterReceipt = async () => { setSaving(true); setError(''); try { const latestRide = await refresh(); if (latestRide.customer_charge_type === 'standard' && latestRide.payment_status !== 'confirmed') { if (latestRide.payment_status !== 'declared') { setError(t('captain.paymentStatusChanged')); return; } await rideDispatchService.confirmCaptainPaymentReceived(rideId); } onConfirmed(); } catch { setError(t('captain.paymentStatusChanged')); } finally { setSaving(false); } };
  return <ScreenShell title={t('captain.endRideTitle')}>
    <View style={styles.hero}><Text style={styles.title}>{t('captain.rideSummary')}</Text></View>
    <View style={[styles.card, shadows.card]}><View style={styles.stats}><Stat label={t('captain.totalDuration')} value={duration} /><Stat label={t('captain.totalDistance')} value={ride?.travelled_distance_km == null ? '—' : `${formatNumber(Number(ride.travelled_distance_km), { maximumFractionDigits: 1 })} km`} /></View><View style={styles.divider} /><Row label={t('captain.baseFare')} value={formatFare(baseFare)} /><Row label={t('captain.adjustment')} value={formatFare(adjustment)} /><View style={styles.divider} /><Row label={t('captain.entitledEarning')} value={formatFare(total)} total /></View>
    {(isFreeRide || paymentConfirmed) && <View style={styles.cash}><Text style={styles.cashIcon}>✓</Text><View style={styles.cashText}><Text style={styles.cashTitle}>{t('captain.receivedEarning', { amount: formatFare(total) })}</Text><Text style={styles.cashDetail}>{payout?.is_held ? t('captain.payoutHeld') : t('captain.bankPayoutEndOfDay')}</Text>{payout && <Text style={styles.cashDetail}>{t(`captain.payoutStatus${payout.payout_status}`)}</Text>}</View></View>}
    {!!error && <Text style={styles.error}>{error}</Text>}
    {needsPaymentIssue && <CaptainPaymentIssueFlow rideId={rideId} available />}
    <PrimaryButton label={saving ? t('login.pleaseWait') : isFreeRide || paymentConfirmed ? t('actions.continue') : t('captain.paymentReceived')} onPress={() => { void continueAfterReceipt(); }} disabled={saving} />
  </ScreenShell>;
}
function Row({ label, value, total = false }: { label: string; value: string; total?: boolean }) { return <View style={styles.row}><Text style={[styles.rowLabel, total && styles.totalLabel]}>{label}</Text><Text style={[styles.rowValue, total && styles.totalValue]}>{value}</Text></View>; }
function Stat({ label, value }: { label: string; value: string }) { return <View style={styles.stat}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
const styles = StyleSheet.create({ hero: { alignItems: 'center', paddingTop: 14 }, title: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900' }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 15, padding: 20 }, stats: { flexDirection: 'row', gap: 10 }, stat: { backgroundColor: colors.primaryLight, borderRadius: radii.md, flex: 1, gap: 4, padding: 12 }, statLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs }, statValue: { color: colors.primary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, row: { flexDirection: 'row', justifyContent: 'space-between' }, rowLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md }, rowValue: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, divider: { backgroundColor: colors.divider, height: 1 }, totalLabel: { color: colors.textPrimary, fontWeight: '900' }, totalValue: { color: colors.primary, fontSize: fontSize.xl, fontWeight: '900' }, cash: { alignItems: 'center', backgroundColor: colors.successLight, borderRadius: radii.lg, flexDirection: 'row', gap: 12, padding: 16 }, cashIcon: { fontSize: 29 }, cashText: { flex: 1 }, cashTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, cashDetail: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' } });
