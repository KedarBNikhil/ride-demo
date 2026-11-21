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
  noHeader?: boolean;
  keyboardAvoiding?: boolean;
  scrollRef?: React.RefObject<ScrollView | null>;
  rightAction?: { label: string; onPress: () => void; disabled?: boolean };
};

export function ScreenShell({ children, back, title, noHeader = false, keyboardAvoiding = false, scrollRef, rightAction }: Props) {
  const content = (
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {!noHeader && (
        <ScreenHeader back={back} title={title} rightAction={rightAction} />
      )}
      {keyboardAvoiding ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.content}>
          {content}
        </KeyboardAvoidingView>
      ) : content}
    </SafeAreaView>
  );
}

export function ScreenHeader({ back, title, rightAction }: Omit<Props, 'children' | 'noHeader' | 'keyboardAvoiding' | 'scrollRef'>) {
  const { t } = useTranslation();
  return <View style={styles.header}>
    {back ? <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={back} style={styles.backBtn} hitSlop={12}><Text style={styles.backText}>‹</Text></Pressable> : <View style={styles.backPlaceholder} />}
    {title ? <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text> : null}
    {rightAction ? <Pressable accessibilityRole="button" accessibilityLabel={rightAction.label} disabled={rightAction.disabled} onPress={rightAction.onPress} style={[styles.rightAction, rightAction.disabled && styles.rightActionDisabled]}><Text style={styles.rightActionText}>{rightAction.label}</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: { flex: 1 },
  header: {
    alignItems: 'center',
    backgroundColor: colors.bg,
    flexDirection: 'row',
    gap: 16,
    minHeight: 72,
    paddingHorizontal: 20,
  },
  backBtn: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 32,
  },
  backText: {
    color: colors.textPrimary,
    fontSize: 40,
    fontWeight: '300',
    lineHeight: 32,
  },
  backPlaceholder: {
    width: 32,
  },
  rightAction: {
    alignItems: 'flex-end',
    marginLeft: 'auto',
  },
  rightActionDisabled: { opacity: 0.55 },
  rightActionText: {
    color: colors.primaryDark,
    fontFamily: fontFamilySemiBold,
    fontSize: fontSize.sm,
  },
  headerTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily: fontFamilyExtraBold,
    fontSize: fontSize.xl,
  },
  scroll: {
    flexGrow: 1,
    gap: layout.sectionGap,
    padding: layout.screenHorizontalPadding,
    paddingBottom: 28,
  },
});
