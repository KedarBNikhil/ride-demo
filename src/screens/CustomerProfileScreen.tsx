import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { CustomerTabBar } from './CustomerScreens';
import { colors, fontFamily, fontSize, layout, radii } from '../theme';
import { getCurrentProfile, type CurrentProfile } from '../services/currentProfile';
import { rideDispatchService, type ReceivedRating } from '../services/rideDispatch';
import { deleteCurrentAccount } from '../services/accountDeletion';
import { useDialog } from '../components/ThemedDialog';
import { selectionHaptic } from '../utils/haptics';
import { useBottomTabBarMetrics } from '../utils/safeAreaLayout';

function displayPhoneNumber(phone: string | null | undefined) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : phone;
}

export function CustomerProfileScreen({ onHome, onBookings, onSettings, onSafety, onAccountDeleted }: { onHome: () => void; onBookings: () => void; onSettings: () => void; onSafety: () => void; onAccountDeleted: () => void }) {
  const { t } = useTranslation();
  const { tabBarHeight } = useBottomTabBarMetrics();
  const dialog = useDialog();
  const [profile, setProfile] = useState<CurrentProfile | null>(null);
  const [rating, setRating] = useState<ReceivedRating | null>(null);
  const [deleting, setDeleting] = useState(false);

  useFocusEffect(useCallback(() => {
    void getCurrentProfile().then(setProfile).catch(() => setProfile(null));
    void rideDispatchService.getReceivedRating('customer').then(setRating).catch(() => setRating(null));
    return undefined;
  }, []));

  const confirmDelete = () => {
    if (deleting) return;
    dialog({
      title: t('profile.deleteAccountTitle'),
      message: t('profile.deleteAccountConfirmation'),
      buttons: [
        { text: t('actions.cancel'), style: 'cancel' },
        { text: t('profile.deleteAccountAction'), style: 'destructive', onPress: () => { void (async () => {
          setDeleting(true);
          try {
            await deleteCurrentAccount('customer');
            onAccountDeleted();
          } catch {
            dialog({ title: t('login.tryAgain') });
          } finally {
            setDeleting(false);
          }
        })(); } },
      ],
    });
  };

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{t('screens.profile')}</Text>
      <View style={styles.accountCard}>
        <View style={styles.avatar} accessibilityLabel="Profile picture placeholder"><View style={styles.avatarHead} /><View style={styles.avatarBody} /></View>
        <View style={styles.accountDetails}>
          <Text style={styles.name}>{profile?.name ?? '—'}</Text>
          <Text style={styles.phone}>{displayPhoneNumber(profile?.phone)}</Text>
          <Text style={styles.rating}>{rating?.average == null ? '—' : `★ ${rating.average.toFixed(2)}`}</Text>
        </View>
      </View>
      <Pressable accessibilityRole="button" onPress={() => { selectionHaptic(); onSettings(); }} style={({ pressed }) => [styles.menuRow, pressed && styles.rowPressed]}>
        <Text style={styles.rowIcon}>⚙</Text><Text style={styles.rowTitle}>{t('screens.settings')}</Text><Text style={styles.chevron}>›</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => { selectionHaptic(); onSafety(); }} style={({ pressed }) => [styles.safetyRow, pressed && styles.rowPressed]}>
        <Text style={styles.rowIcon}>🛡</Text><View style={styles.safetyText}><Text style={styles.rowTitle}>{t('home.safetyTitle')}</Text><Text style={styles.subtitle}>{t('home.safetySubtitle')}</Text></View><Text style={styles.chevron}>›</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={deleting} onPress={() => { selectionHaptic(); confirmDelete(); }} style={({ pressed }) => [styles.deleteRow, pressed && styles.deleteRowPressed, deleting && styles.disabled]}>
        <Text style={styles.deleteText}>{deleting ? t('login.pleaseWait') : t('profile.deleteAccountAction')}</Text>
      </Pressable>
    </ScrollView>
    <CustomerTabBar active="profile" onHome={onHome} onBookings={onBookings} onProfile={() => undefined} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: layout.sectionGap, padding: layout.screenHorizontalPadding },
  title: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900' },
  accountCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, paddingHorizontal: layout.cardPaddingHorizontal, paddingVertical: layout.cardPaddingVertical },
  avatar: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 48, justifyContent: 'center', width: 48 },
  avatarHead: { backgroundColor: '#66717D', borderRadius: radii.pill, height: 16, width: 16 },
  avatarBody: { backgroundColor: '#66717D', borderTopLeftRadius: radii.pill, borderTopRightRadius: radii.pill, height: 14, marginTop: 4, width: 28 },
  accountDetails: { flex: 1, gap: 2 },
  name: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  phone: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm },
  rating: { color: '#F59E0B', fontFamily, fontSize: fontSize.sm, fontWeight: '900' },
  menuRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  safetyRow: { alignItems: 'center', backgroundColor: colors.primaryLight, borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 64, paddingHorizontal: layout.cardPaddingHorizontal },
  rowPressed: { backgroundColor: colors.surfaceSecondary },
  rowIcon: { fontSize: 20, width: 24 },
  rowTitle: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  safetyText: { flex: 1, gap: 1 },
  subtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs },
  chevron: { color: colors.textMuted, fontSize: 26 },
  deleteRow: { alignItems: 'center', borderColor: colors.error, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  deleteRowPressed: { backgroundColor: colors.errorLight },
  disabled: { opacity: 0.6 },
  deleteText: { color: colors.error, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
});
