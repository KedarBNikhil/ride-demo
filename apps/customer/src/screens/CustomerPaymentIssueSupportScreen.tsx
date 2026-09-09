import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rideDispatchService, type CustomerPaymentIssue, type CustomerPaymentIssueMessage } from '../services/rideDispatch';
import { colors, fontFamily, fontSize, radii } from '../theme';

export function CustomerPaymentIssueSupportScreen({ rideId, onBack }: { rideId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<CustomerPaymentIssue | null>(null);
  const [messages, setMessages] = useState<CustomerPaymentIssueMessage[]>([]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const messageListRef = useRef<ScrollView>(null);
  const scrollToLatest = () => requestAnimationFrame(() => messageListRef.current?.scrollToEnd({ animated: true }));
  const refresh = useCallback(() => {
    void Promise.all([rideDispatchService.getCustomerPaymentIssue(rideId), rideDispatchService.getCustomerPaymentIssueMessages(rideId)])
      .then(([nextIssue, nextMessages]) => { setIssue(nextIssue); setMessages(nextMessages); setFailed(false); scrollToLatest(); })
      .catch(() => setFailed(true));
  }, [rideId]);
  useEffect(() => { refresh(); }, [refresh]);
  const send = async () => {
    const message = body.trim();
    if (!message || saving) return;
    setSaving(true);
    try { await rideDispatchService.sendCustomerPaymentIssueMessage(rideId, message); setBody(''); refresh(); } catch { setFailed(true); } finally { setSaving(false); }
  };
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}><View style={styles.header}><Pressable accessibilityRole="button" onPress={onBack} style={styles.back}><Text style={styles.backText}>{t('actions.back')}</Text></Pressable><Text style={styles.title} numberOfLines={1}>{t('rides.customerSupportChatTitle')}</Text><View style={styles.back} /></View><KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}><View style={styles.container}><Text style={styles.hint}>{issue?.assigned_support_id ? t('rides.customerSupportChatHint') : t('rides.customerSupportChatWaiting')}</Text><ScrollView ref={messageListRef} contentContainerStyle={styles.messages} style={styles.messageList} keyboardShouldPersistTaps="handled" onContentSizeChange={scrollToLatest}>{messages.length ? messages.map((message) => <View key={message.id} style={[styles.bubble, message.sender_type === 'customer' ? styles.customerBubble : styles.supportBubble]}><Text style={styles.sender}>{message.sender_type === 'customer' ? t('rides.customerSupportChatYou') : t('rides.customerSupportChatAgent')}</Text><Text style={styles.body}>{message.body}</Text></View>) : <Text style={styles.empty}>{t('rides.customerSupportChatEmpty')}</Text>}</ScrollView>{failed && <Text style={styles.error}>{t('rides.customerSupportChatFailed')}</Text>}<View style={styles.composer}><TextInput value={body} onChangeText={setBody} maxLength={500} multiline placeholder={t('rides.customerSupportChatPlaceholder')} placeholderTextColor={colors.textMuted} style={styles.input} /><Pressable accessibilityRole="button" disabled={saving || !body.trim() || issue?.status !== 'open'} onPress={() => { void send(); }} style={({ pressed }) => [styles.send, (saving || !body.trim() || issue?.status !== 'open') && styles.sendDisabled, pressed && styles.sendPressed]}><Text style={styles.sendText}>{saving ? '…' : t('rides.customerSupportChatSend')}</Text></Pressable></View></View></KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.bg, flex: 1 }, header: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', minHeight: 52, paddingHorizontal: 20 }, back: { minWidth: 64 }, backText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '700' }, title: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.md, fontWeight: '800', textAlign: 'center' }, keyboard: { flex: 1 }, container: { flex: 1, gap: 10, padding: 16 }, hint: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 }, messageList: { flex: 1, minHeight: 0 }, messages: { gap: 10, paddingVertical: 4 }, bubble: { borderRadius: radii.md, gap: 3, maxWidth: '84%', padding: 12 }, customerBubble: { alignSelf: 'flex-end', backgroundColor: colors.primaryLight }, supportBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface }, sender: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, fontWeight: '800' }, body: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 }, empty: { color: colors.textMuted, fontFamily, fontSize: fontSize.sm, paddingVertical: 12, textAlign: 'center' }, composer: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 }, input: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, flex: 1, fontFamily, maxHeight: 108, minHeight: 46, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: 'top' }, send: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.primaryDark, borderRadius: radii.md, justifyContent: 'center', minWidth: 68, paddingHorizontal: 10 }, sendDisabled: { opacity: 0.45 }, sendPressed: { opacity: 0.82 }, sendText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '900' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, textAlign: 'center' },
});
