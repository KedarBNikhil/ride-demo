import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ScreenShell } from '../../components/ScreenShell';
import { rideDispatchService, type CaptainPaymentIssueMessage } from '../../services/rideDispatch';
import { colors, fontFamily, fontSize, radii } from '../../theme';

export function CaptainPaymentIssueSupportScreen({ rideId, onBack }: { rideId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<CaptainPaymentIssueMessage[]>([]);
  const [body, setBody] = useState(''); const [saving, setSaving] = useState(false); const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => { void rideDispatchService.getCaptainPaymentIssueMessages(rideId).then((next) => { setMessages(next); setFailed(false); }).catch(() => setFailed(true)); }, [rideId]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 10_000); return () => clearInterval(timer); }, [refresh]);
  const send = async () => { const text = body.trim(); if (!text || saving) return; setSaving(true); try { await rideDispatchService.sendCaptainPaymentIssueMessage(rideId, text); setBody(''); refresh(); } catch { setFailed(true); } finally { setSaving(false); } };
  return <ScreenShell back={onBack} title={t('captain.supportChatTitle')}><View style={styles.container}><Text style={styles.hint}>{t('captain.supportChatHint')}</Text><ScrollView contentContainerStyle={styles.messages} style={styles.messageList}>{messages.length ? messages.map((message) => <View key={message.id} style={[styles.bubble, message.sender_type === 'captain' ? styles.captainBubble : styles.supportBubble]}><Text style={styles.sender}>{message.sender_type === 'captain' ? t('captain.supportChatYou') : t('captain.supportChatAgent')}</Text><Text style={styles.body}>{message.body}</Text></View>) : <Text style={styles.empty}>{t('captain.supportChatEmpty')}</Text>}</ScrollView>{failed && <Text style={styles.error}>{t('captain.supportChatFailed')}</Text>}<TextInput value={body} onChangeText={setBody} maxLength={500} multiline placeholder={t('captain.supportChatPlaceholder')} placeholderTextColor={colors.textMuted} style={styles.input} /><PrimaryButton label={saving ? t('login.pleaseWait') : t('captain.supportChatSend')} onPress={() => { void send(); }} disabled={saving || !body.trim()} /></View></ScreenShell>;
}

const styles = StyleSheet.create({ container: { flex: 1, gap: 10 }, hint: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 19 }, messageList: { flex: 1 }, messages: { gap: 8, paddingVertical: 6 }, bubble: { borderRadius: radii.md, gap: 3, maxWidth: '88%', padding: 11 }, captainBubble: { alignSelf: 'flex-end', backgroundColor: colors.primaryLight }, supportBubble: { alignSelf: 'flex-start', backgroundColor: colors.bgAlt }, sender: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, fontWeight: '800' }, body: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 }, empty: { color: colors.textMuted, fontFamily, fontSize: fontSize.sm, paddingVertical: 20, textAlign: 'center' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, textAlign: 'center' }, input: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, fontFamily, minHeight: 72, padding: 11, textAlignVertical: 'top' } });
