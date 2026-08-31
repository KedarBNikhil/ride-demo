import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { useDialog } from '../components/ThemedDialog';
import { LEGAL_URLS } from '../legal/legalUrls';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';

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
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.row, shadows.soft]}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.chevron}>›</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  rows: { gap: 10 },
  row: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1.5, flexDirection: 'row', padding: 16 },
  title: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.lg, fontWeight: '800' },
  chevron: { color: colors.textMuted, fontSize: 26 },
});
