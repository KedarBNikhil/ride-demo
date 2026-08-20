import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenShell } from '../../components/ScreenShell';
import { formatFare, formatNumber } from '../../utils/format';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';
import { rideDispatchService, type DispatchRide } from '../../services/rideDispatch';
export function EndRideScreen({ rideId, onBack, onConfirmed }: { rideId: string; onBack: () => void; onConfirmed: () => void }) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [ride, setRide] = useState<DispatchRide | null>(null);
  useEffect(() => { void rideDispatchService.getRide(rideId).then(setRide).catch(() => setRide(null)); }, [rideId]);
  const durationSeconds = ride?.started_at && ride?.completed_at ? Math.max(0, Math.floor((new Date(ride.completed_at).getTime() - new Date(ride.started_at).getTime()) / 1000)) : null;
  const duration = durationSeconds == null ? '—' : `${formatNumber(Math.floor(durationSeconds / 60))}:${formatNumber(durationSeconds % 60).padStart(2, '0')}`;
  const baseFare = Number(ride?.base_fare ?? ride?.estimated_fare ?? 0);
  const adjustment = Number(ride?.distance_surcharge ?? 0) + Number(ride?.pickup_surcharge ?? 0);
  const total = Number(ride?.final_fare ?? ride?.estimated_fare ?? 0);
  const confirm = async () => { setSaving(true); onConfirmed(); };
  return <ScreenShell back={onBack} title={t('captain.endRideTitle')}>
    <View style={styles.hero}><Text style={styles.title}>{t('captain.rideSummary')}</Text></View>
    <View style={[styles.card, shadows.card]}>
      <View style={styles.stats}><Stat label={t('captain.totalDuration')} value={duration} /><Stat label={t('captain.totalDistance')} value={ride?.travelled_distance_km == null ? '—' : `${formatNumber(Number(ride.travelled_distance_km), { maximumFractionDigits: 1 })} km`} /></View>
      <View style={styles.divider} /><Row label={t('captain.baseFare')} value={formatFare(baseFare)} /><Row label={t('captain.adjustment')} value={formatFare(adjustment)} /><View style={styles.divider} /><Row label={t('captain.totalDue')} value={formatFare(total)} total />
    </View>
    <View style={styles.cash}><Text style={styles.cashIcon}>📲</Text><View><Text style={styles.cashTitle}>{t('captain.paymentOnCustomer')}</Text><Text style={styles.cashDetail}>{t('captain.paymentOnCustomerHint')}</Text></View></View>
    <PrimaryButton label={saving ? t('login.pleaseWait') : t('actions.continue')} onPress={() => { void confirm(); }} disabled={saving} />
  </ScreenShell>;
}
function Row({ label, value, total = false }: { label: string; value: string; total?: boolean }) { return <View style={styles.row}><Text style={[styles.rowLabel, total && styles.totalLabel]}>{label}</Text><Text style={[styles.rowValue, total && styles.totalValue]}>{value}</Text></View>; }
function Stat({ label, value }: { label: string; value: string }) { return <View style={styles.stat}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>; }
const styles = StyleSheet.create({ hero: { alignItems: 'center', paddingTop: 14 }, title: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900' }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 15, padding: 20 }, stats: { flexDirection: 'row', gap: 10 }, stat: { backgroundColor: colors.primaryLight, borderRadius: radii.md, flex: 1, gap: 4, padding: 12 }, statLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs }, statValue: { color: colors.primary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, row: { flexDirection: 'row', justifyContent: 'space-between' }, rowLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md }, rowValue: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, divider: { backgroundColor: colors.divider, height: 1 }, totalLabel: { color: colors.textPrimary, fontWeight: '900' }, totalValue: { color: colors.primary, fontSize: fontSize.xl, fontWeight: '900' }, cash: { alignItems: 'center', backgroundColor: colors.successLight, borderRadius: radii.lg, flexDirection: 'row', gap: 12, padding: 16 }, cashIcon: { fontSize: 29 }, cashTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, cashDetail: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm } });
