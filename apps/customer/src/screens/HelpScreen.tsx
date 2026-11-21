import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { colors, fontFamily, fontSize, layout, radii } from '../theme';

export function HelpScreen({ onBack, onSupportIssues }: { onBack: () => void; onSupportIssues: () => void }) {
  return <ScreenShell back={onBack} title="Help">
    <View style={styles.rows}>
      <Pressable accessibilityRole="button" onPress={onSupportIssues} style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.title}>Support & issues</Text>
          <Text style={styles.subtitle}>View your raised issues and support updates</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </View>
  </ScreenShell>;
}

const styles = StyleSheet.create({
  rows: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: 'hidden' },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 72, paddingHorizontal: layout.cardPaddingHorizontal },
  copy: { flex: 1, gap: 3 },
  title: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 },
  chevron: { color: colors.textMuted, fontSize: 26 },
});
