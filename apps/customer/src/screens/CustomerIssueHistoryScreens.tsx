import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenShell';
import { colors, fontFamily, fontSize, layout, radii, shadows } from '../theme';
import { rideDispatchService, type CustomerIssueHistoryItem, type CustomerPaymentIssueMessage } from '../services/rideDispatch';

type IssueFilter = 'all' | 'open' | 'resolved';

function titleCase(value: string | null | undefined) {
  return (value ?? 'Other').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function issueIcon(category: CustomerIssueHistoryItem['issue_category'], size = 27) {
  const glyph = category === 'safety' ? '◇' : category === 'lost_item' ? '▱' : '▣';
  return <Text style={[styles.nativeIcon, { fontSize: size }]}>{glyph}</Text>;
}

function NextIcon() { return <Text style={styles.nextIcon}>›</Text>; }
function CheckIcon() { return <Text style={styles.checkIcon}>✓</Text>; }
function ChatIcon() { return <Text style={styles.chatIcon}>◌</Text>; }

function formatIssueDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(date);
}

export function CustomerIssueHistoryScreen({ onBack, onOpenIssue }: { onBack: () => void; onOpenIssue: (issueId: string) => void }) {
  const [issues, setIssues] = useState<CustomerIssueHistoryItem[]>([]);
  const [filter, setFilter] = useState<IssueFilter>('all');
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(() => { void rideDispatchService.getCustomerIssueHistory().then((items) => { setIssues(items); setFailed(false); }).catch(() => setFailed(true)); }, []);
  useEffect(() => { refresh(); const id = setInterval(refresh, 8_000); return () => clearInterval(id); }, [refresh]);
  const openCount = issues.filter((issue) => issue.status === 'open').length;
  const resolvedCount = issues.filter((issue) => issue.status === 'resolved').length;
  const shown = filter === 'all' ? issues : issues.filter((issue) => issue.status === filter);
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <ScreenHeader back={onBack} title="Support & issues" />
    <ScrollView contentContainerStyle={styles.historyContent} showsVerticalScrollIndicator={false}>
      <View style={styles.filters}><FilterChip label="All" active={filter === 'all'} onPress={() => setFilter('all')} /><FilterChip label={`Open ${openCount}`} active={filter === 'open'} onPress={() => setFilter('open')} /><FilterChip label={`Resolved ${resolvedCount}`} active={filter === 'resolved'} onPress={() => setFilter('resolved')} /></View>
      {failed ? <Text style={styles.muted}>We couldn’t load your issues. Pull down to try again.</Text> : null}
      {!failed && !shown.length ? <View style={styles.emptyCard}><ChatIcon /><Text style={styles.emptyTitle}>No issues here</Text><Text style={styles.muted}>Issues you raise for completed rides will appear here.</Text></View> : null}
      {shown.map((issue) => <Pressable key={issue.id} accessibilityRole="button" onPress={() => onOpenIssue(issue.id)} style={({ pressed }) => [styles.issueCard, issue.status === 'open' && styles.openIssueCard, shadows.soft, pressed && styles.pressed]}>
        <View style={styles.issueHead}><View style={styles.iconBubble}>{issueIcon(issue.issue_category)}</View><View style={styles.issueMeta}><Text style={styles.category}>{titleCase(issue.issue_category)}</Text><Text style={styles.rideMeta}>Ride on {formatIssueDate(issue.ride_completed_at ?? issue.opened_at)}{issue.customer_charge != null ? ` · ₹${Math.round(issue.customer_charge)}` : ''}</Text></View><NextIcon /></View>
        <Text style={styles.issueReason}>{titleCase(issue.reason)}</Text>
        <View style={styles.issueFooter}>{issue.status === 'resolved' ? <><StatusPill label="Resolved" /><Text style={styles.resolvedOn}>Resolved on {formatIssueDate(issue.resolved_at)}</Text></> : <><StatusPill label={issue.support_requested_at ? 'Support requested' : 'Open'} warning={Boolean(issue.support_requested_at)} />{(issue.unread_support_messages ?? 0) > 0 ? <Text style={styles.unread}>{issue.unread_support_messages} new message{issue.unread_support_messages === 1 ? '' : 's'}</Text> : null}</>}</View>
      </Pressable>)}
    </ScrollView>
  </SafeAreaView>;
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.filterChip, active && styles.filterChipActive]}><Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text></Pressable>;
}

export function CustomerIssueDetailsScreen({ issueId, onBack }: { issueId: string; onBack: () => void }) {
  const [issue, setIssue] = useState<CustomerIssueHistoryItem | null>(null);
  const [messages, setMessages] = useState<CustomerPaymentIssueMessage[]>([]);
  const [body, setBody] = useState('');
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const refresh = useCallback(() => { void Promise.all([rideDispatchService.getCustomerIssueDetail(issueId), rideDispatchService.getCustomerIssueMessagesById(issueId)]).then(([nextIssue, nextMessages]) => { setIssue(nextIssue); setMessages(nextMessages); setFailed(false); void rideDispatchService.markCustomerIssueMessagesReadById(issueId).catch(() => undefined); }).catch(() => setFailed(true)); }, [issueId]);
  useEffect(() => { refresh(); const id = setInterval(refresh, 8_000); return () => clearInterval(id); }, [refresh]);
  const send = async () => { if (!body.trim() || sending || issue?.status !== 'open') return; setSending(true); try { await rideDispatchService.sendCustomerIssueMessageById(issueId, body); setBody(''); refresh(); } catch { setFailed(true); } finally { setSending(false); } };
  const requestSupport = async () => { try { await rideDispatchService.requestCustomerIssueSupportById(issueId); refresh(); } catch { setFailed(true); } };
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}><ScreenHeader back={onBack} title="Issue details" /><KeyboardAvoidingView style={styles.detailKeyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
    {issue ? <>
      <View style={[styles.detailCard, shadows.soft]}><View style={styles.detailTitleRow}><View style={styles.iconBubble}>{issueIcon(issue.issue_category)}</View><View style={styles.detailCopy}><Text style={styles.category}>{titleCase(issue.issue_category)}</Text><Text style={styles.detailReason}>{titleCase(issue.reason)}</Text><Text style={styles.rideMeta}>Ride on {formatIssueDate(issue.ride_completed_at ?? issue.opened_at)}{issue.customer_charge != null ? ` · ₹${Math.round(issue.customer_charge)}` : ''}</Text></View></View><StatusPill label={issue.status === 'resolved' ? 'Resolved' : issue.support_requested_at ? 'Support requested' : 'Open'} warning={Boolean(issue.support_requested_at && issue.status === 'open')} /></View>
      {issue.status === 'resolved' ? <View style={[styles.detailCard, shadows.soft]}><View style={styles.resolutionTitle}><View style={styles.iconBubble}><CheckIcon /></View><Text style={styles.cardTitle}>Resolution</Text></View><Text style={styles.resolutionText}>{issue.resolution_note}</Text><Text style={styles.rideMeta}>Resolved by Sawaari Support on {formatIssueDate(issue.resolved_at)}</Text></View> : <View style={[styles.detailCard, shadows.soft]}><Text style={styles.cardTitle}>Support</Text><Text style={styles.rideMeta}>{issue.support_requested_at ? 'Your support request has been sent. A representative will reply here.' : 'Need help from Sawaari Support?'}</Text>{!issue.support_requested_at ? <Pressable accessibilityRole="button" onPress={() => { void requestSupport(); }} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Contact customer support</Text></Pressable> : null}</View>}
      <View style={[styles.detailCard, shadows.soft]}><View style={styles.resolutionTitle}><View style={styles.iconBubble}><ChatIcon /></View><Text style={styles.cardTitle}>Conversation</Text></View>{issue.customer_note ? <MessageBubble sender="You" body={issue.customer_note} customer createdAt={issue.opened_at} /> : null}{messages.length ? messages.map((message) => <MessageBubble key={message.id} sender={message.sender_type === 'customer' ? 'You' : 'Sawaari Support'} body={message.body} customer={message.sender_type === 'customer'} createdAt={message.created_at} />) : <Text style={styles.muted}>No messages yet.</Text>}</View>
      {issue.status === 'open' ? <View style={styles.composer}><TextInput style={styles.input} value={body} onChangeText={setBody} maxLength={500} multiline placeholder="Write a message to Sawaari Support" placeholderTextColor={colors.textMuted} /><Pressable accessibilityRole="button" disabled={!body.trim() || sending} onPress={() => { void send(); }} style={[styles.sendButton, (!body.trim() || sending) && styles.sendDisabled]}><Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text></Pressable></View> : <Pressable accessibilityRole="button" onPress={onBack} style={styles.outlineButton}><Text style={styles.outlineButtonText}>Need more help?</Text></Pressable>}
    </> : <Text style={styles.muted}>{failed ? 'We couldn’t load this issue. Please try again.' : 'Loading issue…'}</Text>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

function MessageBubble({ sender, body, customer, createdAt }: { sender: string; body: string; customer: boolean; createdAt: string }) {
  return <View style={[styles.messageBubble, customer ? styles.customerMessage : styles.supportMessage]}><Text style={styles.messageSender}>{sender} · {formatIssueDate(createdAt)}</Text><Text style={styles.messageBody}>{body}</Text></View>;
}

function StatusPill({ label, warning = false }: { label: string; warning?: boolean }) {
  return <View style={[styles.statusPill, warning && styles.statusPillWarning]}><Text style={[styles.statusText, warning && styles.statusTextWarning]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.bg, flex: 1 }, nextIcon: { color: colors.textPrimary, fontSize: 36, lineHeight: 36 }, nativeIcon: { color: colors.textPrimary, fontWeight: '900', lineHeight: 32, textAlign: 'center' }, checkIcon: { color: colors.success, fontSize: 34, fontWeight: '900', lineHeight: 38 }, chatIcon: { color: colors.textPrimary, fontSize: 34, fontWeight: '900', lineHeight: 36 }, historyContent: { gap: 16, padding: layout.screenHorizontalPadding, paddingBottom: 34 }, filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, filterChip: { borderColor: colors.primaryDark, borderRadius: radii.pill, borderWidth: 1.5, minWidth: 112, paddingHorizontal: 18, paddingVertical: 12 }, filterChipActive: { backgroundColor: colors.primaryDark }, filterText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800', textAlign: 'center' }, filterTextActive: { color: colors.textOnPrimary }, issueCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl, borderWidth: 1, gap: 14, padding: 18 }, openIssueCard: { backgroundColor: colors.surfaceMint, borderColor: '#B9EBC7' }, pressed: { opacity: 0.76 }, issueHead: { alignItems: 'center', flexDirection: 'row', gap: 12 }, iconBubble: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 56, justifyContent: 'center', width: 56 }, issueMeta: { flex: 1, gap: 2 }, category: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, rideMeta: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, issueReason: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, issueFooter: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, statusPill: { borderColor: colors.success, borderRadius: radii.pill, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 5 }, statusPillWarning: { borderColor: '#F97316' }, statusText: { color: colors.success, fontFamily, fontSize: fontSize.sm, fontWeight: '900' }, statusTextWarning: { color: '#EA6C00' }, unread: { color: colors.success, fontFamily, fontSize: fontSize.sm, fontWeight: '900' }, resolvedOn: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl, borderWidth: 1, gap: 8, padding: 28 }, emptyTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, muted: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 21, textAlign: 'center' }, detailKeyboard: { flex: 1 }, detailContent: { gap: 16, padding: layout.screenHorizontalPadding, paddingBottom: 28 }, detailCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl, borderWidth: 1, gap: 14, padding: 18 }, detailTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 14 }, detailCopy: { flex: 1, gap: 3 }, detailReason: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, resolutionTitle: { alignItems: 'center', flexDirection: 'row', gap: 12 }, cardTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, resolutionText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900', lineHeight: 28 }, outlineButton: { alignItems: 'center', borderColor: colors.primaryDark, borderRadius: radii.xl, borderWidth: 2, justifyContent: 'center', minHeight: 54, paddingHorizontal: 16 }, outlineButtonText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, messageBubble: { borderRadius: radii.lg, gap: 8, padding: 14 }, customerMessage: { backgroundColor: colors.primaryLight, marginLeft: 24 }, supportMessage: { backgroundColor: colors.surfaceSecondary, marginRight: 24 }, messageSender: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '900' }, messageBody: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, lineHeight: 24 }, composer: { alignItems: 'flex-end', flexDirection: 'row', gap: 8 }, input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, color: colors.textPrimary, flex: 1, fontFamily, minHeight: 54, padding: 12, textAlignVertical: 'top' }, sendButton: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.primaryDark, borderRadius: radii.lg, justifyContent: 'center', minWidth: 72, paddingHorizontal: 12 }, sendDisabled: { opacity: 0.45 }, sendText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '900' },
});
