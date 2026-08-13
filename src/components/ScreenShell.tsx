import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';
import { NandyalBackdrop } from './NandyalBackdrop';

type Props = {
  children: React.ReactNode;
  back?: () => void;
  title?: string;
  noHeader?: boolean;
};

export function ScreenShell({ children, back, title, noHeader = false }: Props) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <NandyalBackdrop />
      {!noHeader && (
        <View style={styles.header}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              onPress={back}
              style={styles.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.backChevron}>‹</Text>
              <Text style={styles.backText}>{t('actions.back')}</Text>
            </Pressable>
          ) : (
            <View style={styles.backPlaceholder} />
          )}
          {title ? (
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          <View style={styles.backPlaceholder} />
        </View>
      )}
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...shadows.soft,
  },
  backBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    minWidth: 64,
  },
  backChevron: {
    color: colors.textOnPrimary,
    fontSize: 28,
    lineHeight: 32,
    marginTop: -2,
  },
  backText: {
    color: colors.textOnPrimary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  backPlaceholder: {
    minWidth: 64,
  },
  headerTitle: {
    color: colors.textOnPrimary,
    flex: 1,
    fontFamily,
    fontSize: fontSize.md,
    fontWeight: '800',
    textAlign: 'center',
  },
  scroll: {
    flexGrow: 1,
    gap: 18,
    padding: 20,
    paddingBottom: 40,
  },
});
