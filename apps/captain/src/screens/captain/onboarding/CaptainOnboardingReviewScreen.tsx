import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { ScreenShell } from '../../../components/ScreenShell';
import { colors, fontFamily, fontSize, radii, shadows } from '../../../theme';

/** The captain must wait here; only staff approval creates a captain profile. */
export function CaptainOnboardingReviewScreen({ onExit, onApproved, onRefresh }: { onExit: () => void; onApproved: () => Promise<void>; onRefresh: () => Promise<'draft' | 'submitted' | 'approved' | 'rejected'> }) {
  const { t } = useTranslation(); const [checking, setChecking] = useState(false); const [status, setStatus] = useState('');
  const refresh = async () => { setChecking(true); try { const next = await onRefresh(); if (next === 'approved') await onApproved(); else setStatus(next === 'rejected' ? t('captain.reviewRejected') : t('captain.reviewStillPending')); } finally { setChecking(false); } };
  return <ScreenShell back={onExit} title={t('captain.reviewTitle')}>
    <View style={styles.hero}><Text style={styles.emoji}>🔎</Text><Text style={styles.title}>{t('captain.reviewHeading')}</Text><Text style={styles.subtitle}>{t('captain.reviewSubtitle')}</Text></View>
    <View style={[styles.card, shadows.soft]}><Text style={styles.cardIcon}>✓</Text><View style={styles.cardText}><Text style={styles.cardTitle}>{t('captain.reviewSubmitted')}</Text><Text style={styles.cardBody}>{t('captain.reviewSecurity')}</Text></View></View>
    {!!status && <Text style={styles.status}>{status}</Text>}
    <PrimaryButton label={checking ? t('login.pleaseWait') : t('captain.checkReviewStatus')} onPress={() => { void refresh(); }} disabled={checking} />
    <PrimaryButton label={t('captain.backToLauncher')} onPress={onExit} />
  </ScreenShell>;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 9, paddingTop: 18 }, emoji: { fontSize: 50 }, title: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900', textAlign: 'center' }, subtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, lineHeight: 24, textAlign: 'center' },
  card: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', gap: 13, padding: 17 }, cardIcon: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, color: colors.primary, fontSize: 24, fontWeight: '900', height: 42, lineHeight: 42, textAlign: 'center', width: 42 }, cardText: { flex: 1, gap: 3 }, cardTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, cardBody: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 }, status: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800', textAlign: 'center' },
});
