import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { captainEarningsService, formatDuration, type CaptainEarningsOverview } from '../../services/captainEarnings';
import { rideDispatchService } from '../../services/rideDispatch';
import { formatFare } from '../../utils/format';
import { colors, fontFamily, fontSize, radii, shadows } from '../../theme';

export function CaptainEarningsScreen({ onHome, onBookings, onSettings }: { onHome: () => void; onBookings: () => void; onSettings: () => void }) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [overview, setOverview] = useState<CaptainEarningsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setLoading(true); setFailed(false);
    void captainEarningsService.getMonth(month).then(setOverview).catch(() => setFailed(true)).finally(() => setLoading(false));
  }, [month]);
  useFocusEffect(load);
  useEffect(() => rideDispatchService.subscribeToCaptainRides(load), [load]);
  const monthLabel = month.toLocaleDateString(i18n.language === 'te' ? 'te-IN' : 'en-IN', { month: 'long', year: 'numeric' });
  const days = overview?.daily ?? [];
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{t('captain.earningsTitle')}</Text>
      <View style={[styles.totalCard, shadows.card]}><Text style={styles.sectionLabel}>{t('captain.monthlyEarnings')}</Text><Text style={styles.totalValue}>{formatFare(overview?.totalEarnings ?? 0)}</Text><Text style={styles.totalDetail}>{monthLabel}</Text></View>
      <View style={styles.monthRow}><Pressable accessibilityRole="button" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={styles.monthButton}><Text style={styles.monthButtonText}>‹</Text></Pressable><Text style={styles.monthTitle}>{monthLabel}</Text><Pressable accessibilityRole="button" onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={styles.monthButton}><Text style={styles.monthButtonText}>›</Text></Pressable></View>
      <Text style={styles.sectionTitle}>{t('captain.dailyEarnings')}</Text>
      {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : failed ? <Pressable onPress={load} style={styles.retry}><Text style={styles.retryText}>{t('captain.earningsRetry')}</Text></Pressable> : <View style={styles.calendar}>{days.map((day) => <View key={day.date.toISOString()} style={styles.day}><Text style={styles.dayNumber}>{day.date.getDate()}</Text><Text style={styles.dayValue}>{formatFare(day.earnings)}</Text></View>)}</View>}
      {!loading && !failed && <>
        <Text style={styles.sectionTitle}>{t('captain.activityTitle')}</Text>
        <View style={styles.activityRow}><Metric label={t('captain.onlineTime')} value={formatDuration(overview?.onlineMinutes ?? null)} /><Metric label={t('captain.rideTime')} value={formatDuration(overview?.rideMinutes ?? 0)} /></View>
        <Text style={styles.sectionTitle}>{t('captain.earningsBreakdown')}</Text>
        <View style={[styles.breakdown, shadows.card]}><BreakdownRow label={t('captain.rideEarnings')} value={formatFare(overview?.rideEarnings ?? 0)} /><BreakdownRow label={t('captain.tips')} value={overview?.tips == null ? '—' : formatFare(overview.tips)} /><BreakdownRow label={t('captain.bonuses')} value={overview?.bonuses == null ? '—' : formatFare(overview.bonuses)} /><View style={styles.divider} /><BreakdownRow label={t('captain.totalEarnings')} value={formatFare(overview?.totalEarnings ?? 0)} total /></View>
        {(overview?.heldEarnings ?? 0) > 0 && <Text style={styles.held}>{t('captain.heldEarningsNotice', { amount: formatFare(overview?.heldEarnings ?? 0) })}</Text>}
      </>}
    </ScrollView>
    <View style={styles.tabBar}><Tab icon="⌂" label={t('captain.tabHome')} onPress={onHome} /><Tab icon="▤" label={t('captain.tabBookings')} onPress={onBookings} /><Tab icon="₹" label={t('captain.tabEarnings')} active /><Tab icon="♙" label={t('captain.tabProfile')} onPress={onSettings} /></View>
  </SafeAreaView>;
}

function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function BreakdownRow({ label, value, total }: { label: string; value: string; total?: boolean }) { return <View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, total && styles.breakdownTotal]}>{label}</Text><Text style={[styles.breakdownValue, total && styles.breakdownTotal]}>{value}</Text></View>; }
function Tab({ icon, label, active, onPress }: { icon: string; label: string; active?: boolean; onPress?: () => void }) { return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={styles.tab}><Text style={[styles.tabIcon, active && styles.tabActive]}>{icon}</Text><Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ safe: { backgroundColor: colors.bg, flex: 1 }, content: { gap: 14, padding: 20, paddingBottom: 100 }, title: { color: colors.textPrimary, fontFamily, fontSize: fontSize['2xl'], fontWeight: '900' }, totalCard: { backgroundColor: colors.primaryDark, borderRadius: radii.lg, gap: 4, padding: 20 }, sectionLabel: { color: colors.surfaceMint, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, totalValue: { color: colors.textOnPrimary, fontFamily, fontSize: 34, fontWeight: '900' }, totalDetail: { color: colors.surfaceMint, fontFamily, fontSize: fontSize.sm }, monthRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }, monthButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 }, monthButtonText: { color: colors.primaryDark, fontSize: 28, lineHeight: 31 }, monthTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, sectionTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900', marginTop: 4 }, calendar: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, day: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, minHeight: 58, padding: 7, width: '13%' }, dayNumber: { color: colors.textSecondary, fontFamily, fontSize: 11, fontWeight: '800' }, dayValue: { color: colors.primaryDark, fontFamily, fontSize: 11, fontWeight: '900', marginTop: 5 }, loader: { marginVertical: 22 }, retry: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, padding: 16 }, retryText: { color: colors.primaryDark, fontFamily, fontWeight: '800' }, activityRow: { flexDirection: 'row', gap: 10 }, metric: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, gap: 4, padding: 14 }, metricValue: { color: colors.primaryDark, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, metricLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, breakdown: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 13, padding: 17 }, breakdownRow: { flexDirection: 'row', justifyContent: 'space-between' }, breakdownLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md }, breakdownValue: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, divider: { backgroundColor: colors.border, height: 1 }, breakdownTotal: { color: colors.primaryDark, fontWeight: '900' }, held: { color: colors.accent, fontFamily, fontSize: fontSize.sm, fontWeight: '800', textAlign: 'center' }, tabBar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', left: 0, minHeight: 76, paddingBottom: 11, paddingTop: 9, position: 'absolute', right: 0 }, tab: { alignItems: 'center', flex: 1, gap: 2, minWidth: 0 }, tabIcon: { color: colors.textMuted, fontSize: 23, lineHeight: 25 }, tabActive: { color: colors.primary }, tabLabel: { color: colors.textMuted, fontFamily, fontSize: 11 }, tabLabelActive: { color: colors.primaryDark, fontWeight: '800' } });
