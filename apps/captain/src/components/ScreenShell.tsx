import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, fontFamily, fontFamilyExtraBold, fontFamilySemiBold, fontSize, layout, shadows } from '../theme';

type Props = {
  children: React.ReactNode;
  back?: () => void;
  title?: string;
  largeTitle?: boolean;
  noHeader?: boolean;
  scrollRef?: React.RefObject<ScrollView | null>;
};

export function ScreenShell({ children, back, title, largeTitle = false, noHeader = false, scrollRef }: Props) {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {!noHeader && (
        <View style={[styles.header, largeTitle && styles.largeHeader]}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              onPress={back}
              style={styles.backBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.backText}>{t('actions.back')}</Text>
            </Pressable>
          ) : (
            <View style={styles.backPlaceholder} />
          )}
          {title ? (
            <Text style={[styles.headerTitle, largeTitle && styles.largeHeaderTitle]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          <View style={styles.backPlaceholder} />
        </View>
      )}
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: 'height' })}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: layout.screenHorizontalPadding,
    paddingVertical: 6,
  },
  backBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    minWidth: 64,
  },
  backText: {
    color: colors.textPrimary,
    fontFamily: fontFamilySemiBold,
    fontSize: fontSize.sm,
  },
  backPlaceholder: {
    minWidth: 64,
  },
  headerTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily: fontFamilyExtraBold,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  largeHeader: { minHeight: 66 },
  largeHeaderTitle: { fontSize: fontSize.xl, fontWeight: '900' },
  scroll: {
    flexGrow: 1,
    gap: layout.sectionGap,
    padding: layout.screenHorizontalPadding,
    paddingBottom: 28,
  },
});
