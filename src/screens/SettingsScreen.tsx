import React, { useCallback, useRef, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../i18n/createI18n';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';
import { ScreenShell } from '../components/ScreenShell';
import { useDialog } from '../components/ThemedDialog';
import { rideDispatchService, type ReceivedRating } from '../services/rideDispatch';

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
      onPress={() => onPress(value)}
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
          shadows.soft,
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
}: {
  onLanguageChange: (language: AppLanguage) => void;
  onBack: () => void;
  profile?: boolean;
  ratingRole?: 'customer' | 'captain';
  onSafety?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialog = useDialog();
  const [receivedRating, setReceivedRating] = useState<ReceivedRating | null>(null);
  const profileText = i18n.language === 'te'
    ? { rating: 'రేటింగ్', noRatings: 'ఇంకా రేటింగ్‌లు లేవు', ratingCount: (count: number) => `${count} రేటింగ్‌లు` }
    : { rating: 'Rating', noRatings: 'No ratings yet', ratingCount: (count: number) => `${count} ratings` };
  useFocusEffect(useCallback(() => {
    if (!ratingRole) return undefined;
    void rideDispatchService.getReceivedRating(ratingRole).then(setReceivedRating).catch(() => setReceivedRating(null));
    return undefined;
  }, [ratingRole]));
  return (
    <ScreenShell back={onBack} title={t(profile ? 'screens.profile' : 'screens.settings')}>
      {/* Section: Language */}
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

      {profile && ratingRole === 'customer' && <Pressable
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
        style={[styles.chip, shadows.soft]}
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
      </Pressable>}

      {ratingRole && <View style={styles.ratingCard}>
        <Text style={styles.ratingLabel}>{t('profile.rating', { defaultValue: profileText.rating })}</Text>
        <Text style={styles.ratingValue}>{receivedRating?.average == null ? '—' : `★ ${receivedRating.average.toFixed(2)}`}</Text>
        {receivedRating?.count ? <Text style={styles.ratingCount}>{t('profile.ratingCount', { count: receivedRating.count, defaultValue: profileText.ratingCount(receivedRating.count) })}</Text> : <Text style={styles.ratingCount}>{t('profile.noRatings', { defaultValue: profileText.noRatings })}</Text>}
      </View>}

      {/* App info */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>{t('app.name')}</Text>
        <Text style={styles.infoSub}>{t('app.demoVersion')}</Text>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  chips: { gap: 10 },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  chipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  languageMark: {
    alignItems: 'center',
    backgroundColor: colors.bgAlt,
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  languageMarkActive: { backgroundColor: colors.primary },
  languageMarkText: { color: colors.accent, fontFamily, fontSize: 21, fontWeight: '900' },
  languageMarkTextActive: { color: colors.textOnPrimary },
  chipText: { flex: 1, gap: 2 },
  chipName: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.lg,
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
  safetyMark: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
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

  infoCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: 4,
    marginTop: 8,
    padding: 20,
  },
  ratingCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 4, marginTop: 8, padding: 20 },
  ratingLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textTransform: 'uppercase' },
  ratingValue: { color: colors.primaryDark, fontFamily, fontSize: fontSize['2xl'], fontWeight: '900' },
  ratingCount: { color: colors.textMuted, fontFamily, fontSize: fontSize.sm },
  infoTitle: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  infoSub: {
    color: colors.textMuted,
    fontFamily,
    fontSize: fontSize.sm,
  },
});
