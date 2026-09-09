import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../components/PrimaryButton';
import { rideDispatchService, type SettlementQueueItem } from '../services/rideDispatch';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';
import { formatFare } from '../utils/format';

export function OperatorReconciliationScreen({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SettlementQueueItem[]>([]);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems(await rideDispatchService.getSettlementQueue()); }
    catch { setError(t('operator.accessError')); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const review = async (item: SettlementQueueItem, action: 'confirmed' | 'flagged') => {
    const note = noteById[item.settlement_id] ?? '';
    if (action === 'flagged' && !note.trim()) return setError(t('operator.flagNoteRequired'));
    setSavingId(item.settlement_id); setError('');
    try {
      await rideDispatchService.reviewSettlement(item.settlement_id, action, note);
      setItems((current) => current.filter((entry) => entry.settlement_id !== item.settlement_id));
    } catch { setError(t('operator.reviewError')); }
    finally { setSavingId(null); }
  };

  return <SafeAreaView style={styles.safe}><View style={styles.header}><View><Text style={styles.title}>{t('operator.title')}</Text><Text style={styles.subtitle}>{t('operator.subtitle')}</Text></View><Pressable onPress={onExit}><Text style={styles.exit}>{t('actions.back')}</Text></Pressable></View><ScrollView contentContainerStyle={styles.content}>{!!error && <Text style={styles.error}>{error}</Text>}{loading ? <Text style={styles.empty}>{t('operator.loading')}</Text> : items.length === 0 ? <Text style={styles.empty}>{t('operator.empty')}</Text> : items.map((item) => <View key={item.settlement_id} style={[styles.card, shadows.card]}><View style={styles.cardTop}><Text style={styles.method}>{item.declared_method === 'upi' ? 'UPI' : t('rides.cash')}</Text><Text style={styles.amount}>{formatFare(item.amount_due)}</Text></View><Text style={styles.route}>{item.pickup_address} → {item.drop_address}</Text><Text style={styles.meta}>{t('operator.customer', { name: item.customer_name })} · {t('operator.captain', { name: item.captain_name })}</Text><Text style={styles.notice}>{t('operator.notProof')}</Text><TextInput value={noteById[item.settlement_id] ?? ''} onChangeText={(value) => setNoteById((current) => ({ ...current, [item.settlement_id]: value }))} placeholder={t('operator.notePlaceholder')} placeholderTextColor={colors.textMuted} maxLength={500} multiline style={styles.note} /><View style={styles.actions}><PrimaryButton label={savingId === item.settlement_id ? t('login.pleaseWait') : t('operator.confirm')} onPress={() => { void review(item, 'confirmed'); }} disabled={savingId !== null} /><Pressable disabled={savingId !== null} onPress={() => { void review(item, 'flagged'); }} style={styles.flag}><Text style={styles.flagText}>{t('operator.flag')}</Text></Pressable></View></View>)}</ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.bg, flex: 1 }, header: { alignItems: 'center', backgroundColor: colors.primary, flexDirection: 'row', justifyContent: 'space-between', padding: 20 }, title: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900' }, subtitle: { color: 'rgba(255,255,255,0.8)', fontFamily, fontSize: fontSize.sm, marginTop: 4 }, exit: { color: colors.textOnPrimary, fontFamily, fontWeight: '800' }, content: { gap: 14, padding: 16 }, card: { backgroundColor: colors.surface, borderRadius: radii.lg, gap: 9, padding: 16 }, cardTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, method: { color: colors.primary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, amount: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, route: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, meta: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, notice: { color: colors.textMuted, fontFamily, fontSize: fontSize.sm }, note: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, fontFamily, minHeight: 70, padding: 10, textAlignVertical: 'top' }, actions: { gap: 10 }, flag: { alignItems: 'center', padding: 8 }, flagText: { color: colors.error, fontFamily, fontWeight: '900' }, error: { color: colors.error, fontFamily, fontWeight: '800', textAlign: 'center' }, empty: { color: colors.textSecondary, fontFamily, paddingTop: 34, textAlign: 'center' },
});
