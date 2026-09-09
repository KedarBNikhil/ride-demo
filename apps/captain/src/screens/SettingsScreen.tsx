import React, { useCallback, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../i18n/createI18n';
import { colors, layout, radii, fontFamily, fontSize } from '../theme';
import { ScreenShell } from '../components/ScreenShell';
import { useDialog } from '../components/ThemedDialog';
import { rideDispatchService, type ReceivedRating } from '../services/rideDispatch';
import { getCurrentProfile, type CurrentProfile } from '../services/currentProfile';
import { deleteCurrentAccount } from '../services/accountDeletion';
import { selectionHaptic } from '../utils/haptics';

function displayPhoneNumber(phone: string | null | undefined) {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : phone;
}

function LangChip({
  symbol,
  name,
  sub,
  value,
  onPress,
  active,
}: {
  symbol: string;
  name: string;
  sub: string;
  value: AppLanguage;
  onPress: (l: AppLanguage) => void;
  active?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={() => { selectionHaptic(); onPress(value); }}
      style={({ pressed }) => pressed && styles.chipPressed}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50 }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()
      }
    >
      <Animated.View
        style={[
          styles.chip,
          active && styles.chipActive,
          { transform: [{ scale }] },
        ]}
      >
        <View style={[styles.languageMark, active && styles.languageMarkActive]}>
          <Text style={[styles.languageMarkText, active && styles.languageMarkTextActive]}>{symbol}</Text>
        </View>
        <View style={styles.chipText}>
          <Text style={[styles.chipName, active && styles.chipNameActive]}>{name}</Text>
          <Text style={[styles.chipSub, active && styles.chipSubActive]}>{sub}</Text>
        </View>
        {active && <Text style={styles.chipCheck}>✓</Text>}
      </Animated.View>
    </Pressable>
  );
}

export function SettingsScreen({
  onLanguageChange,
  onBack,
  profile = false,
  ratingRole,
  onSafety,
  onAbout,
  onDocuments,
  onAccountDeleted,
}: {
  onLanguageChange: (language: AppLanguage) => void;
  onBack: () => void;
  profile?: boolean;
  ratingRole?: 'customer' | 'captain';
  onSafety?: () => void;
  onAbout?: () => void;
  onDocuments?: () => void;
  onAccountDeleted?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialog = useDialog();
  const [receivedRating, setReceivedRating] = useState<ReceivedRating | null>(null);
  const [currentProfile, setCurrentProfile] = useState<CurrentProfile | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const appName = Constants.expoConfig?.name ?? t('app.name');
  const appVersion = Constants.expoConfig?.version;
  const profileText = i18n.language === 'te'
    ? { rating: 'రేటింగ్', noRatings: 'ఇంకా రేటింగ్‌లు లేవు', ratingCount: (count: number) => `${count} రేటింగ్‌లు` }
    : { rating: 'Rating', noRatings: 'No ratings yet', ratingCount: (count: number) => `${count} ratings` };
  useFocusEffect(useCallback(() => {
    if (!ratingRole) return undefined;
    void rideDispatchService.getReceivedRating(ratingRole).then(setReceivedRating).catch(() => setReceivedRating(null));
    return undefined;
  }, [ratingRole]));
  useFocusEffect(useCallback(() => {
    if (!profile) return undefined;
    void getCurrentProfile().then(setCurrentProfile).catch(() => setCurrentProfile(null));
    return undefined;
  }, [profile]));
  const confirmDeleteAccount = () => {
    if (!ratingRole || deletingAccount) return;
    dialog({
      title: t('profile.deleteAccountTitle'),
      message: t('profile.deleteAccountConfirmation'),
      buttons: [
        { text: t('actions.cancel'), style: 'cancel' },
        { text: t('profile.deleteAccountAction'), style: 'destructive', onPress: () => { void (async () => {
          setDeletingAccount(true);
          try {
            await deleteCurrentAccount(ratingRole);
            onAccountDeleted?.();
          } catch {
            dialog({ title: t('login.tryAgain') });
          } finally {
            setDeletingAccount(false);
          }
        })(); } },
      ],
    });
  };
  if (!profile) {
    return <ScreenShell back={onBack} title={t('screens.settings')}>
      <View style={styles.settingsGroup}>
        <Pressable accessibilityRole="button" onPress={() => { selectionHaptic(); setLanguageOpen((open) => !open); }} style={({ pressed }) => [styles.settingsRow, pressed && styles.rowPressed]}>
          <Text style={styles.settingsTitle}>{t('language.change')}</Text><Text style={styles.rowChevron}>{languageOpen ? '⌃' : '›'}</Text>
        </Pressable>
        {languageOpen && <View style={styles.languageRows}>
          <LangChip symbol="త" name="తెలుగు" sub="" value="te" onPress={onLanguageChange} active={i18n.language === 'te'} />
          <LangChip symbol="E" name="English" sub="" value="en" onPress={onLanguageChange} active={i18n.language === 'en'} />
        </View>}
        <Pressable accessibilityRole="button" onPress={onAbout} style={({ pressed }) => [styles.settingsRow, pressed && styles.rowPressed]}>
          <Text style={styles.settingsTitle}>{t('profile.about')}</Text><Text style={styles.rowChevron}>›</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => dialog({ title: t('home.helpTitle'), message: t('profile.helpComingSoon') })} style={({ pressed }) => [styles.settingsRow, pressed && styles.rowPressed]}>
          <Text style={styles.settingsTitle}>{t('profile.help')}</Text><Text style={styles.rowChevron}>›</Text>
        </Pressable>
      </View>
    </ScreenShell>;
  }
  return (
    <ScreenShell back={onBack} title={t(profile ? 'screens.profile' : 'screens.settings')}>
      {/* Section: Language */}
      {profile && <View style={styles.profileCard}>
        <View style={styles.profileAvatar} accessibilityLabel="Profile picture placeholder"><View style={styles.profileAvatarHead} /><View style={styles.profileAvatarBody} /></View>
        <View style={styles.profileDetails}>
          <Text style={styles.profileName}>{currentProfile?.name ?? '—'}</Text>
          <Text style={styles.profilePhone}>{displayPhoneNumber(currentProfile?.phone)}</Text>
        </View>
      </View>}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('language.change')}</Text>
        <View style={styles.chips}>
          <LangChip
            symbol="త"
            name="తెలుగు"
            sub=""
            value="te"
            onPress={onLanguageChange}
            active={i18n.language === 'te'}
          />
          <LangChip
            symbol="E"
            name="English"
            sub=""
            value="en"
            onPress={onLanguageChange}
            active={i18n.language === 'en'}
          />
        </View>
      </View>

      {profile && ratingRole === 'customer' && <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('profile.safety')}</Text>
        <Pressable
        onPress={() => {
          if (onSafety) {
            onSafety();
            return;
          }
          dialog({
            title: t('home.safetyTitle'),
            message: t('home.safetySubtitle'),
            buttons: [
              { text: t('home.safetyShareAction'), onPress: () => dialog({ title: t('home.safetyTitle'), message: t('home.safetyShared') }) },
              { text: t('home.safetyHelpAction'), onPress: () => dialog({ title: t('home.helpTitle'), message: t('home.helpMessage') }) },
              { text: t('actions.done'), style: 'cancel' },
            ],
          });
        }}
        style={styles.menuRow}
        accessibilityRole="button"
      >
        <View style={styles.safetyMark}>
          <View style={styles.safetyShield} />
        </View>
        <View style={styles.chipText}>
          <Text style={styles.chipName}>{t('home.safetyTitle')}</Text>
          <Text style={styles.chipSub}>{t('home.safetySubtitle')}</Text>
        </View>
        <Text style={styles.rowChevron}>›</Text>
        </Pressable>
      </View>}

      {ratingRole && <View style={styles.ratingCard}>
        <Text style={styles.ratingLabel}>{t('profile.rating', { defaultValue: profileText.rating })}</Text>
        <Text style={styles.ratingValue}>{receivedRating?.average == null ? '—' : `★ ${receivedRating.average.toFixed(2)}`}</Text>
        <Text style={styles.ratingCount}>{receivedRating?.count ? t('profile.ratingCount', { count: receivedRating.count, defaultValue: profileText.ratingCount(receivedRating.count) }) : t('profile.noRatings', { defaultValue: profileText.noRatings })}</Text>
      </View>}

      {profile && <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('profile.account')}</Text>
        <View style={styles.groupedRows}>
          {ratingRole === 'captain' && <Pressable onPress={onDocuments} accessibilityRole="button" style={styles.groupedRow}>
            <Text style={styles.chipName}>{t('captain.yourDocuments')}</Text>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>}
          <Pressable onPress={onAbout} accessibilityRole="button" style={styles.groupedRow}>
            <Text style={styles.chipName}>{t('profile.about')}</Text>
            <Text style={styles.rowChevron}>›</Text>
          </Pressable>
        </View>
      </View>}

      {profile && ratingRole && <Pressable onPress={confirmDeleteAccount} disabled={deletingAccount} accessibilityRole="button" style={[styles.deleteAccountButton, deletingAccount && styles.deleteAccountButtonDisabled]}>
        <Text style={styles.deleteAccountText}>{deletingAccount ? t('login.pleaseWait') : t('profile.deleteAccountAction')}</Text>
      </Pressable>}

      {/* App info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>{appName}</Text>
        {appVersion ? <Text style={styles.infoSub}>v{appVersion}</Text> : null}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  section: { gap: layout.compactGap },
  settingsGroup: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: 'hidden' },
  settingsRow: { alignItems: 'center', borderBottomColor: colors.divider, borderBottomWidth: 1, flexDirection: 'row', minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  settingsTitle: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  languageRows: { backgroundColor: colors.surfaceSecondary, gap: 1, paddingVertical: 4 },
  rowPressed: { backgroundColor: colors.surfaceSecondary },
  profileCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, paddingHorizontal: layout.cardPaddingHorizontal, paddingVertical: layout.cardPaddingVertical },
  profileAvatar: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 48, justifyContent: 'center', width: 48 },
  profileAvatarHead: { backgroundColor: '#66717D', borderRadius: radii.pill, height: 16, width: 16 },
  profileAvatarBody: { backgroundColor: '#66717D', borderTopLeftRadius: radii.pill, borderTopRightRadius: radii.pill, height: 14, marginTop: 4, width: 28 },
  profileDetails: { flex: 1, gap: 2 },
  profileName: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  profilePhone: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm },
  sectionLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chips: { gap: layout.compactGap },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: layout.rowMinHeight,
    paddingHorizontal: layout.cardPaddingHorizontal,
  },
  chipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  chipPressed: { opacity: 0.76 },
  languageMark: {
    alignItems: 'center',
    backgroundColor: colors.bgAlt,
    borderRadius: radii.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  languageMarkActive: { backgroundColor: colors.primary },
  languageMarkText: { color: colors.primaryDark, fontFamily, fontSize: 18, fontWeight: '900' },
  languageMarkTextActive: { color: colors.textOnPrimary },
  chipText: { flex: 1, gap: 2 },
  chipName: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  chipNameActive: { color: colors.primary },
  chipSub: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm },
  chipSubActive: { color: colors.primaryDark },
  chipCheck: {
    color: colors.primary,
    fontSize: 20,
    fontWeight: '800',
  },
  menuRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  safetyMark: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  safetyShield: {
    backgroundColor: colors.textOnAccent,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    height: 20,
    width: 16,
  },
  rowChevron: { alignSelf: 'center', color: colors.textMuted, fontSize: 26 },
  groupedRows: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: 'hidden' },
  groupedRow: { alignItems: 'center', flexDirection: 'row', minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  deleteAccountButton: { alignItems: 'center', borderColor: colors.error, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  deleteAccountButtonDisabled: { opacity: 0.6 },
  deleteAccountText: { color: colors.error, fontFamily, fontSize: fontSize.md, fontWeight: '900' },

  infoCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 1,
    marginTop: 0,
    padding: 12,
  },
  ratingCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  ratingLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textTransform: 'uppercase' },
  ratingValue: { color: '#F59E0B', fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  ratingCount: { color: colors.textMuted, flex: 1, fontFamily, fontSize: fontSize.sm, textAlign: 'right' },
  infoTitle: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  infoSub: {
    color: colors.textMuted,
    fontFamily,
    fontSize: fontSize.sm,
  },
});
