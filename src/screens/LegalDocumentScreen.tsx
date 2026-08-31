import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { legalDocuments, type LegalDocumentKind } from '../legal/legalDocuments';
import { colors, fontFamily, fontSize } from '../theme';

export function LegalDocumentScreen({ kind, onBack }: { kind: LegalDocumentKind; onBack: () => void }) {
  const document = legalDocuments[kind];
  return <ScreenShell back={onBack} title={document.title}>
    <Text style={styles.content}>{document.content}</Text>
  </ScreenShell>;
}

const styles = StyleSheet.create({
  content: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, lineHeight: 24 },
});
