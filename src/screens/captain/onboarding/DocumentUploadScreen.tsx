import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../../../components/PrimaryButton';
import { ScreenShell } from '../../../components/ScreenShell';
import type { CaptainDocument, CaptainDocumentType } from '../../../services/captainOnboarding';
import { captainOnboardingService } from '../../../services/captainOnboarding';
import { colors, fontFamily, fontSize, radii, shadows } from '../../../theme';

const documentTypes: { type: CaptainDocumentType; icon: string; label: string }[] = [
  { type: 'license', icon: '🪪', label: 'captain.drivingLicense' },
  { type: 'rc', icon: '🚗', label: 'captain.vehicleRc' },
  { type: 'insurance', icon: '🛡️', label: 'captain.insurance' },
];

export function DocumentUploadScreen({ onBack, onComplete }: { onBack: () => void; onComplete: () => void }) {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<Partial<Record<CaptainDocumentType, CaptainDocument>>>({});
  const [saving, setSaving] = useState(false);
  const allAttached = documentTypes.every(({ type }) => documents[type]);

  const pick = async (type: CaptainDocumentType, source: 'camera' | 'library') => {
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert(t('captain.permissionTitle'), t('captain.permissionMessage')); return; }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setDocuments((current) => ({ ...current, [type]: { uri: asset.uri, name: asset.fileName ?? `${type}-document.jpg` } }));
  };
  const choose = (type: CaptainDocumentType) => Alert.alert(t('captain.addDocument'), t('captain.addDocumentHint'), [
    { text: t('captain.camera'), onPress: () => { void pick(type, 'camera'); } },
    { text: t('captain.gallery'), onPress: () => { void pick(type, 'library'); } },
    { text: t('actions.cancel'), style: 'cancel' },
  ]);
  const continueFlow = async () => {
    if (!allAttached) return;
    setSaving(true);
    await captainOnboardingService.saveDocuments(documents as Record<CaptainDocumentType, CaptainDocument>);
    setSaving(false); onComplete();
  };
  return <ScreenShell back={onBack} title={t('captain.documentTitle')}><View style={styles.hero}><Text style={styles.emoji}>📄</Text><Text style={styles.help}>{t('captain.documentsSubtitle')}</Text></View>
    {documentTypes.map(({ type, icon, label }) => { const document = documents[type]; return <View key={type} style={[styles.slot, shadows.soft]}>{document ? <><Image source={{ uri: document.uri }} style={styles.thumbnail} /><View style={styles.detail}><Text style={styles.slotTitle}>{t(label)}</Text><Text numberOfLines={1} style={styles.fileName}>{document.name}</Text></View><Pressable onPress={() => choose(type)}><Text style={styles.replace}>{t('captain.replace')}</Text></Pressable></> : <><Text style={styles.slotIcon}>{icon}</Text><View style={styles.detail}><Text style={styles.slotTitle}>{t(label)}</Text><Text style={styles.empty}>{t('captain.uploadHint')}</Text></View><Pressable onPress={() => choose(type)} style={styles.upload}><Text style={styles.uploadText}>{t('captain.upload')}</Text></Pressable></>}</View>; })}
    <PrimaryButton label={saving ? t('login.pleaseWait') : t('actions.continue')} onPress={() => { void continueFlow(); }} disabled={!allAttached || saving} />
  </ScreenShell>;
}
const styles = StyleSheet.create({ hero: { alignItems: 'center', gap: 7 }, emoji: { fontSize: 45 }, help: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, textAlign: 'center' }, slot: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 104, padding: 14 }, slotIcon: { fontSize: 31 }, detail: { flex: 1, gap: 4 }, slotTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, empty: { color: colors.textMuted, fontFamily, fontSize: fontSize.sm }, upload: { backgroundColor: colors.primaryLight, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 9 }, uploadText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' }, thumbnail: { backgroundColor: colors.bgAlt, borderRadius: radii.sm, height: 64, width: 64 }, fileName: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, replace: { color: colors.accent, fontFamily, fontSize: fontSize.sm, fontWeight: '800' } });
