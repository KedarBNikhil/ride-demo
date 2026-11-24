import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { ScreenShell } from '../../../components/ScreenShell';
import { useDialog } from '../../../components/ThemedDialog';
import type { CaptainDocument, CaptainDocumentPair, CaptainDocumentType } from '../../../services/captainOnboarding';
import { captainOnboardingService } from '../../../services/captainOnboarding';
import { colors, fontFamily, fontSize, radii, shadows } from '../../../theme';

const documentTypes: { type: CaptainDocumentType; icon: string; label: string }[] = [
  { type: 'license', icon: '🪪', label: 'captain.drivingLicense' },
  { type: 'rc', icon: '🚗', label: 'captain.vehicleRc' },
  { type: 'aadhar', icon: '🪪', label: 'captain.aadharDetails' },
];

export function DocumentUploadScreen({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [documents, setDocuments] = useState<Partial<Record<CaptainDocumentType, Partial<CaptainDocumentPair>>>>({});
  const [saving, setSaving] = useState(false);
  const allAttached = documentTypes.every(({ type }) => documents[type]?.front && documents[type]?.back);

  const pick = async (type: CaptainDocumentType, side: 'front' | 'back', source: 'camera' | 'library') => {
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { dialog({ title: t('captain.permissionTitle'), message: t('captain.permissionMessage') }); return; }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setDocuments((current) => ({ ...current, [type]: { ...current[type], [side]: { uri: asset.uri, name: asset.fileName ?? `${type}-${side}-document.jpg` } } }));
  };
  const choose = (type: CaptainDocumentType, side: 'front' | 'back') => dialog({
    title: t('captain.addDocument'),
    message: t('captain.addDocumentHint'),
    buttons: [
      { text: t('captain.camera'), onPress: () => { void pick(type, side, 'camera'); } },
      { text: t('captain.gallery'), onPress: () => { void pick(type, side, 'library'); } },
      { text: t('actions.cancel'), style: 'cancel' },
    ],
  });
  const continueFlow = async () => {
    if (!allAttached) return;
    setSaving(true);
    try {
      await captainOnboardingService.saveDocuments(documents as Record<CaptainDocumentType, CaptainDocumentPair>);
      onComplete();
    } catch {
      // Keep the selected documents in memory so a transient upload error can
      // be retried without asking the Captain to select all three again.
      dialog({ title: t('captain.documentTitle'), message: t('login.tryAgain') });
    } finally {
      setSaving(false);
    }
  };
  return <ScreenShell back={onBack} title={t('captain.documentTitle')}><View style={styles.hero}><Text style={styles.emoji}>📄</Text><Text style={styles.help}>{t('captain.documentsSubtitle')}</Text></View>
    {documentTypes.map(({ type, icon, label }) => { const document = documents[type]; return <View key={type} style={[styles.slot, shadows.soft]}><Text style={styles.slotIcon}>{icon}</Text><View style={styles.detail}><Text style={styles.slotTitle}>{t(label)}</Text><Text style={styles.empty}>{t('captain.documentSidesHint')}</Text><View style={styles.sideActions}><Pressable onPress={() => choose(type, 'front')} style={[styles.sideButton, document?.front && styles.sideReady]}><Text style={[styles.sideButtonText, document?.front && styles.sideButtonTextReady]}>{document?.front ? t('captain.frontAdded') : t('captain.front')}</Text></Pressable><Pressable onPress={() => choose(type, 'back')} style={[styles.sideButton, document?.back && styles.sideReady]}><Text style={[styles.sideButtonText, document?.back && styles.sideButtonTextReady]}>{document?.back ? t('captain.backAdded') : t('captain.back')}</Text></Pressable></View></View></View>; })}
    <PrimaryButton label={saving ? t('login.pleaseWait') : t('actions.continue')} onPress={() => { void continueFlow(); }} disabled={!allAttached || saving} />
  </ScreenShell>;
}
const styles = StyleSheet.create({ hero: { alignItems: 'center', gap: 7 }, emoji: { fontSize: 45 }, help: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, textAlign: 'center' }, slot: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 118, padding: 14 }, slotIcon: { fontSize: 31 }, detail: { flex: 1, gap: 6 }, slotTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, empty: { color: colors.textMuted, fontFamily, fontSize: fontSize.sm }, sideActions: { flexDirection: 'row', gap: 8 }, sideButton: { backgroundColor: colors.primaryLight, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 8 }, sideReady: { backgroundColor: colors.primary }, sideButtonText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, sideButtonTextReady: { color: colors.surface } });
