import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton } from './PrimaryButton';
import { rideDispatchService } from '../services/rideDispatch';
import { formatFare } from '../utils/format';
import { COMPANY_UPI_ID } from '../config/companyPayment';
import { colors, fontFamily, fontSize, radii } from '../theme';

export function OutstandingBalanceCard() {
  const [row, setRow] = useState<{ amount_due: number; status: string; adjustment_id: string; rejection_reason?: string | null } | null>(null);
  const [utr, setUtr] = useState(''); const [form, setForm] = useState(false); const [saving, setSaving] = useState(false); const [details, setDetails] = useState(false);
  useEffect(() => { void rideDispatchService.getCustomerOutstandingBalance().then((rows) => setRow(rows[0] ?? null)).catch(() => undefined); }, []);
  if (!row) return null;
  const submit = async () => { if (!utr.trim()) return; setSaving(true); try { await rideDispatchService.submitAdjustmentPayment(row.adjustment_id, row.amount_due, utr); setRow({ ...row, status: 'PENDING_VERIFICATION', rejection_reason: null }); setForm(false); } finally { setSaving(false); } };
  return <View style={styles.card}>
    <Text style={styles.title}>Outstanding balance</Text><Text style={styles.amount}>{formatFare(row.amount_due)}</Text><Text style={styles.text}>Previous ride adjustment. Pay this amount to Sawaari using your preferred UPI/payment app.</Text><Text selectable style={styles.upi}>Sawaari UPI ID: {COMPANY_UPI_ID}</Text>
    {row.status === 'PENDING_VERIFICATION' ? <Text style={styles.pending}>Payment verification pending{`\n`}We are verifying your payment to Sawaari.</Text> : <>{row.status === 'REJECTED' && <Text style={styles.rejected}>Payment verification rejected{row.rejection_reason ? `: ${row.rejection_reason}` : ''}</Text>}{form ? <><Text>Payment made to: {COMPANY_UPI_ID}</Text><Text>Amount due: {formatFare(row.amount_due)}</Text><TextInput value={utr} onChangeText={setUtr} placeholder="UTR / UPI transaction reference" style={styles.input} /><PrimaryButton label={saving ? 'Submitting…' : 'Submit for verification'} onPress={() => { void submit(); }} disabled={saving || !utr.trim()} small /></> : <Pressable onPress={() => setForm(true)}><Text style={styles.action}>I Have Paid</Text></Pressable>}</>}
    <Pressable onPress={() => setDetails(!details)}><Text style={styles.action}>View Details</Text></Pressable>{details && <Text style={styles.text}>This balance is separate from any current ride payment.</Text>}<Pressable onPress={() => Alert.alert('Contact Support', 'Use the Help tab to contact Sawaari support.')}><Text style={styles.action}>Contact Support</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({ card:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:radii.lg,gap:8,padding:16},title:{color:colors.textPrimary,fontFamily,fontSize:fontSize.lg,fontWeight:'900'},amount:{color:colors.primary,fontFamily,fontSize:28,fontWeight:'900'},text:{color:colors.textSecondary,fontFamily,fontSize:fontSize.sm},upi:{color:colors.primaryDark,fontFamily,fontSize:fontSize.md,fontWeight:'900'},action:{color:colors.primary,fontFamily,fontWeight:'900',paddingVertical:3},pending:{color:colors.success,fontFamily,fontWeight:'800'},rejected:{color:colors.error,fontFamily,fontWeight:'800'},input:{borderColor:colors.border,borderWidth:1,borderRadius:radii.md,color:colors.textPrimary,fontFamily,padding:10} });
