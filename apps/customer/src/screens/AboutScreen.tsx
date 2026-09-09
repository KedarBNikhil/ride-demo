import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { useDialog } from '../components/ThemedDialog';
import { LEGAL_URLS } from '../legal/legalUrls';
import { colors, fontFamily, fontSize, layout, radii } from '../theme';

export function AboutScreen({ onBack }: { onBack: () => void }) {
  const dialog = useDialog();
  const openLegalUrl = async (url: string) => {
    try {
      if (!await Linking.canOpenURL(url)) throw new Error('Unsupported legal URL');
      await Linking.openURL(url);
    } catch {
      dialog({ title: 'Unable to open this page. Please try again.' });
    }
  };
  return <ScreenShell back={onBack} title="About">
    <View style={styles.rows}>
      <LegalRow title="Privacy Policy" onPress={() => void openLegalUrl(LEGAL_URLS.privacyPolicy)} />
      <LegalRow title="Terms & Conditions" onPress={() => void openLegalUrl(LEGAL_URLS.termsAndConditions)} />
    </View>
  </ScreenShell>;
}

function LegalRow({ title, onPress }: { title: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.chevron}>›</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  rows: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', borderBottomColor: colors.divider, borderBottomWidth: 1, flexDirection: 'row', minHeight: layout.rowMinHeight, paddingHorizontal: layout.cardPaddingHorizontal },
  title: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  chevron: { color: colors.textMuted, fontSize: 26 },
});
