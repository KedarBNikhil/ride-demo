import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../components/PrimaryButton';
import { OutstandingBalanceCard } from '../components/OutstandingBalanceCard';
import { checkRazorpayRidePayment, isRazorpayRideCheckoutEnabled, isRazorpayCheckoutCancelled, startRazorpayRideCheckout } from '../services/razorpayRideCheckout';
import { rideDispatchService } from '../services/rideDispatch';
import { formatFare } from '../utils/format';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';

type PaymentStatus = 'pending' | 'declared' | 'confirmed' | 'not_required';
type PaymentMethod = 'cash' | 'online';
type CaptainRatingPrompt = { rideId: string; captainName: string };

export function CustomerRideSettlement({ rideId, fare, captainName, paymentStatus, freeRide, onHome }: { rideId: string; fare: number; captainName: string; paymentStatus: PaymentStatus; paymentMethod?: 'cash' | 'upi' | 'razorpay' | 'external' | null; freeRide: boolean; onHome: (dismissCompletedRideId?: string, ratingPrompt?: CaptainRatingPrompt) => void }) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<PaymentMethod | null>(null); const [expanded, setExpanded] = useState(false); const [status, setStatus] = useState<PaymentStatus>(paymentStatus); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [breakdown, setBreakdown] = useState({ ride_fare: fare, previous_ride_adjustment: 0, total_payable: fare, adjustment_reason: null as string | null });
  useEffect(() => { setStatus(paymentStatus); }, [paymentStatus]);
  useEffect(() => { void rideDispatchService.getCustomerRidePaymentBreakdown(rideId).then(setBreakdown).catch(() => undefined); }, [rideId]);
  useEffect(() => rideDispatchService.subscribeToRide(rideId, (ride) => setStatus(ride.payment_status ?? 'pending'), () => setError(t('login.tryAgain'))), [rideId, t]);
  const checkingPayment = useRef(false);
  const checkPayment = useCallback(async (showFeedback = false) => {
    if (!isRazorpayRideCheckoutEnabled || checkingPayment.current) return;
    checkingPayment.current = true;
    try {
      const state = await checkRazorpayRidePayment(rideId);
      if (state === 'confirmed') { setStatus('confirmed'); setError(''); }
      else if (showFeedback) setError(t('rides.onlinePaymentStillPending'));
    } catch { if (showFeedback) setError(t('rides.onlinePaymentCheckFailed')); }
    finally { checkingPayment.current = false; }
  }, [rideId, t]);
  useEffect(() => {
    if (status !== 'pending' || freeRide || !isRazorpayRideCheckoutEnabled) return;
    void checkPayment();
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void checkPayment(); });
    const timer = saving && method === 'online' ? setInterval(() => void checkPayment(), 8000) : null;
    return () => { subscription.remove(); if (timer) clearInterval(timer); };
  }, [status, freeRide, saving, method, checkPayment]);
  // Only an authoritative server update can end the ride. In particular, do
  // not treat returning from the native Razorpay sheet as payment confirmation.
  const returnHomeWithRating = () => onHome(rideId, { rideId, captainName });
  useEffect(() => { if (status === 'confirmed' || status === 'not_required') returnHomeWithRating(); }, [captainName, onHome, rideId, status]);
  const confirmCash = async () => { setSaving(true); setError(''); try { const ride = await rideDispatchService.confirmCustomerPayment(rideId, 'cash'); setStatus(ride.payment_status ?? 'declared'); } catch { setError(t('login.tryAgain')); } finally { setSaving(false); } };
  const payOnline = async () => { setSaving(true); setError(''); try { await startRazorpayRideCheckout(rideId, 'upi'); setStatus('confirmed'); } catch (checkoutError) { await checkPayment(); if (!isRazorpayCheckoutCancelled(checkoutError)) setError(checkoutError instanceof Error ? checkoutError.message : t('login.tryAgain')); } finally { setSaving(false); } };
  return <SafeAreaView style={styles.safe}><View style={[styles.card, shadows.card]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close ride summary" hitSlop={12} onPress={returnHomeWithRating} style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
    <Text style={styles.title}>{t('rides.summaryTitle')}</Text><Text style={styles.subtitle}>{t('rides.summaryWithCaptain', { captain: captainName })}</Text>
    <View style={styles.fare}><Text style={styles.sectionTitle}>{t('rides.paymentTotal')}</Text><Text style={styles.fareValue}>{formatFare(breakdown.total_payable)}</Text></View><OutstandingBalanceCard />
    {status === 'pending' ? <><Text style={styles.sectionTitle}>{t('rides.makePayment')}</Text><Text style={styles.helper}>{t('rides.paymentChoiceHint')}</Text><PrimaryButton label={t('rides.selectPaymentMethod')} onPress={() => { setExpanded((open) => !open); setError(''); }} disabled={saving} small />
      {expanded && <View style={styles.options}><PaymentOption label={t('rides.cash')} detail={t('rides.cashPaymentDetail')} selected={method === 'cash'} onPress={() => setMethod('cash')} /><PaymentOption label={t('rides.payOnline')} detail={t('rides.payOnlineDetail')} selected={method === 'online'} onPress={() => setMethod('online')} /></View>}
      {method === 'online' && <Pressable accessibilityRole="button" onPress={() => void checkPayment(true)}><Text style={styles.checkStatus}>{t('rides.checkOnlinePaymentStatus')}</Text></Pressable>}
      {method && <PrimaryButton label={saving ? t('login.pleaseWait') : method === 'cash' ? t('rides.confirmPayment') : t('rides.payOnline')} onPress={() => { void (method === 'cash' ? confirmCash() : payOnline()); }} disabled={saving} />}
    </> : <Text style={styles.helper}>{t('rides.awaitingCaptainPaymentConfirmation')}</Text>}{!!error && <Text style={styles.error}>{error}</Text>}
  </View></SafeAreaView>;
}
function PaymentOption({ label, detail, selected, onPress }: { label: string; detail: string; selected: boolean; onPress: () => void }) { return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[styles.option, selected && styles.optionSelected]}><View style={styles.badge}><Text style={styles.badgeText}>₹</Text></View><View style={styles.optionCopy}><Text style={styles.optionLabel}>{label}</Text><Text style={styles.optionDetail}>{detail}</Text></View><Text style={styles.optionTick}>{selected ? '✓' : '○'}</Text></Pressable>; }
const styles = StyleSheet.create({ checkStatus: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center', padding: 8 }, safe: { backgroundColor: colors.primaryLight, flex: 1, justifyContent: 'center', padding: 20 }, card: { backgroundColor: colors.surface, borderRadius: radii.xl, gap: 15, padding: 22 }, close: { alignItems: 'center', height: 36, justifyContent: 'center', position: 'absolute', right: 14, top: 14, width: 36, zIndex: 1 }, closeText: { color: colors.textSecondary, fontSize: 31, lineHeight: 34 }, title: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900', textAlign: 'center' }, subtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, textAlign: 'center' }, helper: { color: colors.textMuted, fontFamily, fontSize: fontSize.sm, textAlign: 'center' }, fare: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.lg, gap: 4, padding: 16 }, fareValue: { color: colors.primary, fontFamily, fontSize: 30, fontWeight: '900' }, sectionTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, options: { gap: 8 }, option: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 11, minHeight: 60, paddingHorizontal: 12 }, optionSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 2 }, badge: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 32, justifyContent: 'center', width: 32 }, badgeText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, optionCopy: { flex: 1, gap: 2 }, optionLabel: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, optionDetail: { color: colors.textMuted, fontFamily, fontSize: fontSize.xs }, optionTick: { color: colors.primary, fontFamily, fontSize: 22, fontWeight: '900' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' } });
