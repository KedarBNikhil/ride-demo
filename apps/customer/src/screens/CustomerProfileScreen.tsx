import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Bell, Bookmark, ChevronRight, CircleHelp, Gift, History, Info, Languages, ShieldCheck } from 'lucide-react-native';
import { CustomerTabBar } from './CustomerScreens';
import { colors, fontFamily, fontFamilyBold, fontFamilyExtraBold, fontFamilySemiBold, fontSize, layout, radii } from '../theme';
import { getCurrentProfile, type CurrentProfile } from '../services/currentProfile';
import { rideDispatchService, type DispatchRide, type ReceivedRating } from '../services/rideDispatch';
import { deleteCurrentAccount, logoutCurrentDevice } from '../services/accountDeletion';
import { useDialog } from '../components/ThemedDialog';
import { selectionHaptic } from '../utils/haptics';
import { useBottomTabBarMetrics } from '../utils/safeAreaLayout';
import { getCustomerProfileSnapshot, setCustomerProfileSnapshot } from '../services/customerProfileSnapshot';

function displayPhoneNumber(phone: string | null | undefined) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : phone;
}

type ProfileStats = { rides: number; kilometres: number };

function getProfileStats(rides: DispatchRide[]): ProfileStats {
  const completedRides = rides.filter((ride) => ride.status === 'completed');
  const kilometres = completedRides.reduce((total, ride) => total + (ride.travelled_distance_km ?? (ride.trip_distance_meters ?? 0) / 1000), 0);
  return { rides: completedRides.length, kilometres };
}

export function CustomerProfileScreen({ onHome, onBookings, onHelp, onSavedAddresses, onSettings, onSafety, onAbout, onAccountDeleted, onLoggedOut }: { onHome: () => void; onBookings: () => void; onHelp: () => void; onSavedAddresses: () => void; onSettings: () => void; onSafety: () => void; onAbout: () => void; onAccountDeleted: () => void; onLoggedOut: () => void }) {
  const { t } = useTranslation();
  const { tabBarHeight } = useBottomTabBarMetrics();
  const dialog = useDialog();
  const initialSnapshot = getCustomerProfileSnapshot();
  const [profile, setProfile] = useState<CurrentProfile | null>(initialSnapshot?.profile ?? null);
  const [rating, setRating] = useState<ReceivedRating | null>(initialSnapshot?.rating ?? null);
  const [stats, setStats] = useState<ProfileStats | null>(initialSnapshot ? getProfileStats(initialSnapshot.rides) : null);
  const [deleting, setDeleting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useFocusEffect(useCallback(() => {
    void Promise.all([getCurrentProfile(), rideDispatchService.getReceivedRating('customer'), rideDispatchService.getCustomerRideHistory()])
      .then(([nextProfile, nextRating, rides]) => {
        setCustomerProfileSnapshot({ profile: nextProfile, rating: nextRating, rides });
        setProfile(nextProfile); setRating(nextRating); setStats(getProfileStats(rides));
      })
      .catch(() => undefined);
    return undefined;
  }, []));

  const confirmDelete = () => {
    if (deleting || loggingOut) return;
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

  const logout = async () => {
    if (deleting || loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutCurrentDevice();
      onLoggedOut();
    } catch {
      dialog({ title: t('login.tryAgain') });
    } finally {
      setLoggingOut(false);
    }
  };

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]} showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{t('screens.profile')}</Text>
      <View style={styles.profileHeader}>
        <View style={styles.avatar} accessibilityLabel="Profile picture placeholder"><View style={styles.avatarHead} /><View style={styles.avatarBody} /></View>
        <View style={styles.accountDetails}>
          <Text style={styles.name}>{profile?.name ?? '—'}</Text>
          <Text style={styles.phone}>{displayPhoneNumber(profile?.phone)}</Text>
        </View>
      </View>
      <View style={styles.stats}>
        <Stat value={stats ? String(stats.rides) : '—'} label={t('profile.rides')} />
        <Stat value={stats ? stats.kilometres.toFixed(stats.kilometres >= 10 ? 0 : 1) : '—'} label={t('profile.kilometres')} />
        <Stat value={rating?.average == null ? '—' : rating.average.toFixed(1)} label={t('profile.rating')} />
      </View>
      <MenuSection title={t('profile.account')}>
        <MenuRow icon="history" title={t('profile.history')} onPress={onBookings} />
        <MenuRow icon="gift" title={t('profile.offers')} onPress={() => dialog({ title: t('profile.offers'), message: t('profile.offersMessage') })} />
        <MenuRow icon="bookmark" title={t('profile.savedAddresses')} onPress={onSavedAddresses} />
        <MenuRow icon="safety" title={t('profile.setupSafety')} subtitle={t('home.safetySubtitle')} onPress={onSafety} />
      </MenuSection>
      <MenuSection title={t('profile.preferences')}>
        <MenuRow icon="language" title={t('profile.language')} onPress={onSettings} />
        <MenuRow icon="notification" title={t('profile.notifications')} onPress={() => dialog({ title: t('profile.notifications'), message: t('profile.notificationsMessage') })} />
      </MenuSection>
      <MenuSection title={t('profile.support')}>
        <MenuRow icon="help" title={t('profile.help')} onPress={onHelp} />
        <MenuRow icon="about" title={t('profile.about')} onPress={onAbout} />
      </MenuSection>
      <Pressable accessibilityRole="button" disabled={deleting || loggingOut} onPress={() => { selectionHaptic(); void logout(); }} style={({ pressed }) => [styles.logoutRow, pressed && styles.rowPressed, loggingOut && styles.disabled]}>
        <Text style={styles.logoutText}>{loggingOut ? t('profile.loggingOut') : t('profile.logoutAction')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={deleting || loggingOut} onPress={() => { selectionHaptic(); confirmDelete(); }} style={({ pressed }) => [styles.deleteRow, pressed && styles.deleteRowPressed, (deleting || loggingOut) && styles.disabled]}>
        <Text style={styles.deleteText}>{deleting ? t('login.pleaseWait') : t('profile.deleteAccountAction')}</Text>
      </Pressable>
    </ScrollView>
    <CustomerTabBar active="profile" onHome={onHome} onBookings={onBookings} onProfile={() => undefined} />
  </SafeAreaView>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.menuSection}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.menuGroup}>{children}</View></View>;
}

type ProfileMenuIconKind = 'history' | 'gift' | 'bookmark' | 'safety' | 'language' | 'notification' | 'about' | 'help';

function MenuRow({ icon, title, subtitle, onPress }: { icon: ProfileMenuIconKind; title: string; subtitle?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={() => { selectionHaptic(); onPress(); }} style={({ pressed }) => [styles.menuRow, pressed && styles.rowPressed]}>
    <ProfileMenuIcon kind={icon} /><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View><ChevronRight color={colors.textMuted} size={22} strokeWidth={2} />
  </Pressable>;
}

function ProfileMenuIcon({ kind }: { kind: ProfileMenuIconKind }) {
  const props = { color: colors.primary, size: 25, strokeWidth: 2.1 };
  if (kind === 'history') return <View style={styles.iconCanvas}><History {...props} /></View>;
  if (kind === 'gift') return <View style={styles.iconCanvas}><Gift {...props} /></View>;
  if (kind === 'bookmark') return <View style={styles.iconCanvas}><Bookmark {...props} /></View>;
  if (kind === 'notification') return <View style={styles.iconCanvas}><Bell {...props} /></View>;
  if (kind === 'safety') return <View style={styles.iconCanvas}><ShieldCheck {...props} /></View>;
  if (kind === 'help') return <View style={styles.iconCanvas}><CircleHelp {...props} /></View>;
  if (kind === 'about') return <View style={styles.iconCanvas}><Info {...props} /></View>;
  return <View style={styles.iconCanvas}><Languages {...props} /></View>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: layout.sectionGap, padding: layout.screenHorizontalPadding },
  title: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.xl },
  profileHeader: { alignItems: 'center', gap: 12, paddingBottom: 2, paddingTop: 8 },
  avatar: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 76, justifyContent: 'center', width: 76 },
  avatarHead: { backgroundColor: '#66717D', borderRadius: radii.pill, height: 26, width: 26 },
  avatarBody: { backgroundColor: '#66717D', borderTopLeftRadius: radii.pill, borderTopRightRadius: radii.pill, height: 23, marginTop: 6, width: 45 },
  accountDetails: { alignItems: 'center', gap: 2 },
  name: { color: colors.textPrimary, fontFamily: fontFamilyBold, fontSize: fontSize.lg },
  phone: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm },
  stats: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 },
  stat: { alignItems: 'center', flex: 1, gap: 2 },
  statValue: { color: colors.textPrimary, fontFamily: fontFamilyBold, fontSize: fontSize.lg },
  statLabel: { color: colors.textSecondary, fontFamily: fontFamilySemiBold, fontSize: fontSize.xs },
  menuSection: { gap: layout.compactGap },
  sectionTitle: { color: colors.textSecondary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, marginLeft: 2 },
  menuGroup: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl, borderWidth: 1, overflow: 'hidden' },
  menuRow: { alignItems: 'center', flexDirection: 'row', gap: 14, minHeight: 68, paddingHorizontal: layout.cardPaddingHorizontal },
  rowPressed: { backgroundColor: colors.surfaceSecondary },
  iconCanvas: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
  iconSymbol: { color: colors.primary, fontFamily, fontSize: 24, lineHeight: 28, textAlign: 'center' },
  historyCircle: { borderColor: colors.primary, borderRadius: 13, borderWidth: 2.8, height: 26, width: 26 },
  historyHandVertical: { backgroundColor: colors.primary, height: 8, left: 10, position: 'absolute', top: 5, width: 3 },
  historyHandDiagonal: { backgroundColor: colors.primary, height: 3, left: 11, position: 'absolute', top: 12, transform: [{ rotate: '35deg' }], transformOrigin: 'left', width: 7 },
  historyArrow: { backgroundColor: colors.primary, borderBottomLeftRadius: 2, borderTopLeftRadius: 2, bottom: 2, height: 7, left: 1, position: 'absolute', transform: [{ rotate: '30deg' }], width: 10 },
  giftBox: { borderColor: colors.primary, borderRadius: 2, borderWidth: 2.6, height: 18, position: 'absolute', top: 12, width: 25 },
  giftRibbonVertical: { backgroundColor: colors.primary, height: 18, left: 9, position: 'absolute', width: 3 },
  giftRibbonHorizontal: { backgroundColor: colors.primary, height: 3, left: 0, position: 'absolute', top: 5, width: 20 },
  giftBowLeft: { borderColor: colors.primary, borderRadius: 5, borderWidth: 2.6, height: 8, left: 5, position: 'absolute', top: 5, transform: [{ rotate: '30deg' }], width: 10 },
  giftBowRight: { borderColor: colors.primary, borderRadius: 5, borderWidth: 2.6, height: 8, position: 'absolute', right: 5, top: 5, transform: [{ rotate: '-30deg' }], width: 10 },
  bookmarkIcon: { borderColor: colors.primary, borderBottomWidth: 0, borderRadius: 2, borderWidth: 2.8, height: 28, overflow: 'hidden', width: 20 },
  bookmarkNotch: { backgroundColor: colors.surface, bottom: -6, height: 13, position: 'absolute', right: 3, transform: [{ rotate: '45deg' }], width: 13 },
  notificationSquareTop: { borderColor: colors.primary, borderRadius: 2, borderWidth: 2.6, height: 11, left: 1, position: 'absolute', top: 5, width: 11 },
  notificationLineTop: { backgroundColor: colors.primary, borderRadius: 2, height: 4, position: 'absolute', right: 0, top: 9, width: 17 },
  notificationSquareBottom: { borderColor: colors.primary, borderRadius: 2, borderWidth: 2.6, bottom: 5, height: 11, left: 1, position: 'absolute', width: 11 },
  notificationLineBottom: { backgroundColor: colors.primary, borderRadius: 2, bottom: 9, height: 4, position: 'absolute', right: 0, width: 17 },
  shieldIcon: { borderColor: colors.primary, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, borderTopLeftRadius: 5, borderTopRightRadius: 5, borderWidth: 2.8, height: 28, overflow: 'hidden', width: 24 },
  shieldCheck: { borderBottomColor: colors.primary, borderRightColor: colors.primary, borderRightWidth: 3, borderBottomWidth: 3, height: 9, left: 6, position: 'absolute', top: 6, transform: [{ rotate: '45deg' }], width: 5 },
  supportRing: { alignItems: 'center', borderColor: colors.primary, borderRadius: 15, borderWidth: 3, height: 30, justifyContent: 'center', overflow: 'hidden', width: 30 },
  supportCentre: { borderColor: colors.primary, borderRadius: 8, borderWidth: 3, height: 16, width: 16 },
  supportBandOne: { backgroundColor: colors.primary, height: 3, position: 'absolute', transform: [{ rotate: '45deg' }], width: 37 },
  supportBandTwo: { backgroundColor: colors.primary, height: 3, position: 'absolute', transform: [{ rotate: '-45deg' }], width: 37 },
  infoIcon: { alignItems: 'center', borderColor: colors.primary, borderRadius: 13, borderWidth: 2.8, height: 26, justifyContent: 'center', width: 26 },
  infoIconText: { color: colors.primary, fontFamily, fontSize: 19, fontWeight: '900', lineHeight: 22 },
  rowCopy: { flex: 1, gap: 1 },
  rowTitle: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.md },
  subtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs },
  chevron: { color: colors.textMuted, fontSize: 26 },
  logoutRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  logoutText: { color: colors.textPrimary, fontFamily: fontFamilyBold, fontSize: fontSize.md },
  deleteRow: { alignItems: 'center', borderColor: colors.error, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  deleteRowPressed: { backgroundColor: colors.errorLight },
  disabled: { opacity: 0.6 },
  deleteText: { color: colors.error, fontFamily: fontFamilyBold, fontSize: fontSize.md },
});
