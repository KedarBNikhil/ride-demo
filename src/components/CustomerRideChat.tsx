import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from './PrimaryButton';
import { rideDispatchService, type RideMessage } from '../services/rideDispatch';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';

const quickMessages = ['Are you coming?', 'Waiting at pickup', 'My location is as per map', 'Message when reached'];

export function CustomerRideChat({ rideId, captainName, onBack }: { rideId: string; captainName: string; onBack: () => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [quickChatOpen, setQuickChatOpen] = useState(true);
  useEffect(() => rideDispatchService.subscribeToRideMessages(rideId, (nextMessages) => {
    setMessages(nextMessages);
    setError('');
  }, () => setError(t('rides.chatLoadFailed'))), [rideId, t]);
  const send = async (messageToSend = body) => {
    const message = messageToSend.trim();
    if (!message || saving) return;
    setSaving(true);
    setError('');
    try {
      await rideDispatchService.sendRideMessage(rideId, message);
      setBody('');
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch {
      setError(t('rides.chatSendFailed'));
    } finally {
      setSaving(false);
    }
  };
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.screen}><View style={[styles.heading, styles.header, shadows.soft]}><Pressable accessibilityRole="button" accessibilityLabel={t('rides.closeChat')} onPress={onBack} hitSlop={12}><Text style={styles.back}>‹</Text></Pressable><View style={styles.captainAvatar}><Text style={styles.captainAvatarText}>👤</Text></View><Text style={styles.title} numberOfLines={1}>{captainName}</Text></View><ScrollView style={styles.chatContent} contentContainerStyle={styles.chatContentInner} keyboardShouldPersistTaps="handled"><View style={styles.messages}>{messages.length ? messages.map((message) => <Text key={message.id} style={styles.message}>{message.body}</Text>) : <Text style={styles.empty}>{t('rides.noMessages')}</Text>}</View></ScrollView><View style={styles.quickChat}><Pressable accessibilityRole="button" accessibilityState={{ expanded: quickChatOpen }} onPress={() => setQuickChatOpen((open) => !open)} style={styles.quickChatHeader}><Text style={styles.quickChatTitle}>{t('rides.quickChat')}</Text><Text style={styles.quickChatToggle}>{quickChatOpen ? '⌃' : '⌄'}</Text></Pressable>{quickChatOpen && quickMessages.map((message) => <Pressable key={message} accessibilityRole="button" disabled={saving} onPress={() => { void send(message); }} style={styles.quickMessage}><Text style={styles.quickMessageText}>{message}</Text></Pressable>)}</View><View style={styles.composer}><TextInput ref={inputRef} value={body} onChangeText={setBody} onFocus={() => setQuickChatOpen(false)} placeholder={t('rides.chatPlaceholder')} placeholderTextColor={colors.textMuted} maxLength={500} multiline style={styles.input} returnKeyType="send" blurOnSubmit={false} onSubmitEditing={() => { void send(); }} /><PrimaryButton label={saving ? t('login.pleaseWait') : t('rides.sendMessage')} onPress={() => { void send(); }} disabled={saving || !body.trim()} small /></View>{!!error && <Text style={styles.error}>{error}</Text>}</KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { backgroundColor: colors.surface, flex: 1 }, screen: { flex: 1 }, heading: { alignItems: 'center', flexDirection: 'row' }, header: { backgroundColor: colors.surface, gap: 12, minHeight: 76, paddingHorizontal: 20 }, back: { color: colors.textPrimary, fontSize: 42, lineHeight: 42 }, captainAvatar: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 42, justifyContent: 'center', width: 42 }, captainAvatarText: { fontSize: 23 }, title: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, chatContent: { flex: 1 }, chatContentInner: { gap: 16, padding: 20 }, messages: { gap: 8, minHeight: 120 }, message: { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radii.md, color: colors.textPrimary, fontFamily, padding: 10 }, empty: { color: colors.textMuted, fontFamily, marginTop: 32, textAlign: 'center' }, quickChat: { borderColor: colors.border, borderRadius: radii.xl, borderWidth: 1, gap: 10, marginHorizontal: 20, padding: 14 }, quickChatHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, quickChatTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, quickChatToggle: { color: colors.textSecondary, fontSize: 22 }, quickMessage: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 12 }, quickMessageText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm }, composer: { alignItems: 'center', flexDirection: 'row', gap: 10, padding: 20 }, input: { borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, color: colors.textPrimary, flex: 1, fontFamily, maxHeight: 96, minHeight: 46, paddingHorizontal: 14, paddingVertical: 11, textAlignVertical: 'top' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, paddingHorizontal: 20, paddingBottom: 10 } });
