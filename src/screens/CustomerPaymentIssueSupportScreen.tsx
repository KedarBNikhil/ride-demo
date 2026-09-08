import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ScreenShell } from '../components/ScreenShell';
import { PrimaryButton } from '../components/PrimaryButton';
import { rideDispatchService, type CustomerPaymentIssue, type CustomerPaymentIssueMessage } from '../services/rideDispatch';
import { colors, fontFamily, fontSize, radii } from '../theme';

export function CustomerPaymentIssueSupportScreen({ rideId, onBack }: { rideId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<CustomerPaymentIssue | null>(null);
  const [messages, setMessages] = useState<CustomerPaymentIssueMessage[]>([]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => {
    void Promise.all([rideDispatchService.getCustomerPaymentIssue(rideId), rideDispatchService.getCustomerPaymentIssueMessages(rideId)])
      .then(([nextIssue, nextMessages]) => { setIssue(nextIssue); setMessages(nextMessages); setFailed(false); })
      .catch(() => setFailed(true));
  }, [rideId]);
  useEffect(() => { refresh(); }, [refresh]);
  const send = async () => {
    const message = body.trim();
    if (!message || saving) return;
    setSaving(true);
    try { await rideDispatchService.sendCustomerPaymentIssueMessage(rideId, message); setBody(''); refresh(); } catch { setFailed(true); } finally { setSaving(false); }
  };
  return <ScreenShell back={onBack} title={t('rides.customerSupportChatTitle')}><View style={styles.container}><Text style={styles.hint}>{issue?.assigned_support_id ? t('rides.customerSupportChatHint') : t('rides.customerSupportChatWaiting')}</Text><ScrollView contentContainerStyle={styles.messages} style={styles.messageList}>{messages.length ? messages.map((message) => <View key={message.id} style={[styles.bubble, message.sender_type === 'customer' ? styles.customerBubble : styles.supportBubble]}><Text style={styles.sender}>{message.sender_type === 'customer' ? t('rides.customerSupportChatYou') : t('rides.customerSupportChatAgent')}</Text><Text style={styles.body}>{message.body}</Text></View>) : <Text style={styles.empty}>{t('rides.customerSupportChatEmpty')}</Text>}</ScrollView>{failed && <Text style={styles.error}>{t('rides.customerSupportChatFailed')}</Text>}<TextInput value={body} onChangeText={setBody} maxLength={500} multiline placeholder={t('rides.customerSupportChatPlaceholder')} placeholderTextColor={colors.textMuted} style={styles.input} /><PrimaryButton label={saving ? t('login.pleaseWait') : t('rides.customerSupportChatSend')} onPress={() => { void send(); }} disabled={saving || !body.trim() || issue?.status !== 'open'} /></View></ScreenShell>;
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: 12, padding: 20 }, hint: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 }, messageList: { flex: 1 }, messages: { gap: 10, paddingVertical: 4 }, bubble: { borderRadius: radii.md, gap: 3, maxWidth: '84%', padding: 12 }, customerBubble: { alignSelf: 'flex-end', backgroundColor: colors.primaryLight }, supportBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface }, sender: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, fontWeight: '800' }, body: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 }, empty: { color: colors.textMuted, fontFamily, fontSize: fontSize.sm, paddingVertical: 12, textAlign: 'center' }, input: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, fontFamily, minHeight: 88, padding: 12, textAlignVertical: 'top' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, textAlign: 'center' },
});
