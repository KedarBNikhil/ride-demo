import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AppLanguage } from '../i18n/createI18n';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';

type Props = { onChoose: (language: AppLanguage) => void };

function LangTile({
  flag,
  name,
  sub,
  value,
  onChoose,
  primary,
}: {
  flag: string;
  name: string;
  sub: string;
  value: AppLanguage;
  onChoose: (l: AppLanguage) => void;
  primary?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={() => onChoose(value)}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50 }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()
      }
    >
      <Animated.View
        style={[
          styles.tile,
          primary ? styles.tilePrimary : styles.tileSecondary,
          shadows.card,
          { transform: [{ scale }] },
        ]}
      >
        <Text style={styles.tileFlag}>{flag}</Text>
        <View style={styles.tileText}>
          <Text style={[styles.tileName, primary && styles.tileNamePrimary]}>{name}</Text>
          <Text style={[styles.tileSub, primary && styles.tileSubPrimary]}>{sub}</Text>
        </View>
        <Text style={[styles.tileArrow, primary && styles.tileArrowPrimary]}>›</Text>
      </Animated.View>
    </Pressable>
  );
}

export function LanguageSelectScreen({ onChoose }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.page}>
      {/* Top accent strip */}
      <View style={styles.strip}>
        <Text style={styles.stripEmoji}>🌐</Text>
      </View>

      {/* Card */}
      <View style={styles.card}>
        <Text style={styles.title}>{t('language.choose')}</Text>
        <Text style={styles.helper}>{t('language.helper')}</Text>
        <View style={styles.tiles}>
          <LangTile
            flag="🇮🇳"
            name="తెలుగు"
            sub="Telugu"
            value="te"
            onChoose={onChoose}
            primary
          />
          <LangTile
            flag="🔤"
            name="English"
            sub="ఇంగ్లీష్"
            value="en"
            onChoose={onChoose}
          />
        </View>
      </View>

      <Text style={styles.footer}>నంద్యాల రైడ్ · Nandyal Ride</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  strip: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    height: 80,
    justifyContent: 'center',
    marginBottom: 28,
    width: 80,
  },
  stripEmoji: { fontSize: 38 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: 28,
    width: '100%',
    ...shadows.card,
    gap: 6,
  },
  title: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize['2xl'],
    fontWeight: '900',
    textAlign: 'center',
  },
  helper: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.md,
    lineHeight: 26,
    marginBottom: 8,
    textAlign: 'center',
  },
  tiles: { gap: 12, marginTop: 8 },

  tile: {
    alignItems: 'center',
    borderRadius: radii.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  tilePrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  tileSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  tileFlag: { fontSize: 28 },
  tileText: { flex: 1, gap: 2 },
  tileName: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  tileNamePrimary: { color: colors.textOnPrimary },
  tileSub: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
  },
  tileSubPrimary: { color: 'rgba(255,255,255,0.75)' },
  tileArrow: { color: colors.textMuted, fontSize: 24 },
  tileArrowPrimary: { color: 'rgba(255,255,255,0.8)' },

  footer: {
    color: colors.textMuted,
    fontFamily,
    fontSize: 12,
    marginTop: 28,
    textAlign: 'center',
  },
});
