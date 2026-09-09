import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from './PrimaryButton';
import { rideDispatchService, type RideMessage } from '../services/rideDispatch';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';

export function CaptainRideChat({ rideId, customerName, onBack }: { rideId: string; customerName: string; onBack: () => void }) {
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => rideDispatchService.subscribeToRideMessages(rideId, (nextMessages) => {
    setMessages(nextMessages);
    setError('');
  }, () => setError(t('rides.chatLoadFailed'))), [rideId, t]);
  const send = async () => {
    const message = body.trim();
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
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.screen}><View style={[styles.header, shadows.soft]}><Pressable accessibilityRole="button" accessibilityLabel={t('rides.closeChat')} onPress={onBack} hitSlop={12}><Text style={styles.back}>‹</Text></Pressable><View style={styles.avatar}><Text style={styles.avatarText}>👤</Text></View><Text style={styles.title} numberOfLines={1}>{customerName}</Text></View><ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent} keyboardShouldPersistTaps="handled">{messages.length ? messages.map((message) => <Text key={message.id} style={styles.message}>{message.body}</Text>) : <Text style={styles.empty}>{t('rides.noMessages')}</Text>}</ScrollView><View style={styles.composer}><TextInput ref={inputRef} value={body} onChangeText={setBody} placeholder={t('rides.chatPlaceholder')} placeholderTextColor={colors.textMuted} maxLength={500} multiline style={styles.input} returnKeyType="send" blurOnSubmit={false} onSubmitEditing={() => { void send(); }} /><PrimaryButton label={saving ? t('login.pleaseWait') : t('rides.sendMessage')} onPress={() => { void send(); }} disabled={saving || !body.trim()} small /></View>{!!error && <Text style={styles.error}>{error}</Text>}</KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { backgroundColor: colors.surface, flex: 1 }, screen: { flex: 1 }, header: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row', gap: 12, minHeight: 76, paddingHorizontal: 20 }, back: { color: colors.textPrimary, fontSize: 42, lineHeight: 42 }, avatar: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 42, justifyContent: 'center', width: 42 }, avatarText: { fontSize: 23 }, title: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, messages: { flex: 1 }, messagesContent: { gap: 8, padding: 20 }, message: { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radii.md, color: colors.textPrimary, fontFamily, padding: 10 }, empty: { color: colors.textMuted, fontFamily, marginTop: 32, textAlign: 'center' }, composer: { alignItems: 'center', flexDirection: 'row', gap: 10, padding: 20 }, input: { borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, color: colors.textPrimary, flex: 1, fontFamily, maxHeight: 96, minHeight: 46, paddingHorizontal: 14, paddingVertical: 11, textAlignVertical: 'top' }, error: { color: colors.error, fontFamily, fontSize: fontSize.sm, paddingBottom: 10, paddingHorizontal: 20 } });
