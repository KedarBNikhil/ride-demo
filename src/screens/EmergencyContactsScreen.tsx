import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as Contacts from 'expo-contacts';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenShell } from '../components/ScreenShell';
import { emergencyContactsService, type EmergencyContact } from '../services/emergencyContacts';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';

type PermissionState = 'undetermined' | 'granted' | 'denied';
type DeviceContact = { key: string; name: string; phone: string };

function toDeviceContact(contact: Contacts.ExistingContact): DeviceContact | null {
  const phone = contact.phoneNumbers?.[0]?.number?.trim();
  if (!contact.name || !phone) return null;
  return { key: contact.id, name: contact.name, phone };
}

export function EmergencyContactsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [mode, setMode] = useState<'overview' | 'picker'>('overview');
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  const [deviceLoading, setDeviceLoading] = useState(false);
  const [addedKeys, setAddedKeys] = useState<string[]>([]);
  const [manualName, setManualName] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const autoOpened = useRef(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    emergencyContactsService.list()
      .then((list) => { if (active) { setSaved(list); setLoadFailed(false); } })
      .catch(() => { if (active) setLoadFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []));

  useEffect(() => {
    Contacts.getPermissionsAsync()
      .then(({ status }) => setPermission(status === 'granted' ? 'granted' : status === 'undetermined' ? 'undetermined' : 'denied'))
      .catch(() => setPermission('denied'));
  }, []);

  const loadDeviceContacts = useCallback(async () => {
    setDeviceLoading(true);
    try {
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        sort: Contacts.SortTypes.FirstName,
      });
      setDeviceContacts(data.map(toDeviceContact).filter((contact): contact is DeviceContact => contact !== null));
    } catch {
      setDeviceContacts([]);
    } finally {
      setDeviceLoading(false);
    }
  }, []);

  const openPicker = useCallback(() => {
    setMode('picker');
    void loadDeviceContacts();
  }, [loadDeviceContacts]);

  useEffect(() => {
    if (!loading && permission === 'granted' && saved.length === 0 && mode === 'overview' && !autoOpened.current) {
      autoOpened.current = true;
      openPicker();
    }
  }, [loading, permission, saved.length, mode, openPicker]);

  const requestAccess = async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      const next: PermissionState = status === 'granted' ? 'granted' : status === 'undetermined' ? 'undetermined' : 'denied';
      setPermission(next);
      if (next === 'granted') openPicker();
    } catch {
      setPermission('denied');
    }
  };

  const openAddFlow = () => {
    if (permission === 'granted') {
      openPicker();
      return;
    }
    if (permission === 'undetermined') {
      void requestAccess();
      return;
    }
    setMode('overview');
  };

  const addContact = async (name: string, phone: string, key?: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const created = await emergencyContactsService.add(name, phone);
      setSaved((current) => [...current, created]);
      if (key) setAddedKeys((current) => [...current, key]);
      setManualName('');
      setManualPhone('');
    } catch {
      Alert.alert(t('safety.title'), t('safety.addFailed'));
    } finally {
      setSaving(false);
    }
  };

  const saveManual = () => {
    const name = manualName.trim();
    const phone = manualPhone.trim();
    if (name.length < 2 || phone.replace(/\D/g, '').length < 6) {
      Alert.alert(t('safety.title'), t('safety.invalidEntry'));
      return;
    }
    void addContact(name, phone);
  };

  const confirmRemove = (contact: EmergencyContact) => {
    Alert.alert(t('safety.removeTitle'), t('safety.removeMessage', { name: contact.contactName }), [
      { text: t('rides.stay'), style: 'cancel' },
      {
        text: t('safety.remove'), style: 'destructive', onPress: () => {
          emergencyContactsService.remove(contact.id)
            .then(() => setSaved((current) => current.filter((item) => item.id !== contact.id)))
            .catch(() => Alert.alert(t('safety.title'), t('safety.loadFailed')));
        },
      },
    ]);
  };

  if (mode === 'picker') {
    const savedPhones = new Set(saved.map((contact) => contact.phoneNumber.replace(/\s+/g, '')));
    return (
      <ScreenShell back={() => setMode('overview')} title={t('safety.pickTitle')}>
        {deviceLoading ? <Text style={styles.note}>{t('login.pleaseWait')}</Text> : deviceContacts.length === 0 ? (
          <View style={[styles.card, shadows.soft]}>
            <Text style={styles.cardTitle}>{t('safety.emptyDevice')}</Text>
            <Text style={styles.cardText}>{t('safety.emptyDeviceHint')}</Text>
            <PrimaryButton label={t('safety.manual')} onPress={() => setMode('overview')} />
          </View>
        ) : (
          <View style={[styles.card, shadows.soft]}>
            {deviceContacts.map((contact, index) => {
              const alreadySaved = addedKeys.includes(contact.key) || savedPhones.has(contact.phone.replace(/\s+/g, ''));
              return (
                <View key={contact.key} style={[styles.row, index < deviceContacts.length - 1 && styles.rowDivider]}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowName} numberOfLines={1}>{contact.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{contact.phone}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: alreadySaved }}
                    disabled={alreadySaved || saving}
                    onPress={() => void addContact(contact.name, contact.phone, contact.key)}
                    style={[styles.plusButton, alreadySaved && styles.plusButtonAdded]}
                  >
                    <Text style={[styles.plusText, alreadySaved && styles.plusTextAdded]}>{alreadySaved ? '✓' : '+'}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
        <Text style={styles.note}>{t('safety.pickHint')}</Text>
      </ScreenShell>
    );
  }

  if (loading) {
    return (
      <ScreenShell back={onBack} title={t('safety.title')}>
        <Text style={styles.note}>{t('login.pleaseWait')}</Text>
      </ScreenShell>
    );
  }

  const hasContacts = saved.length > 0;

  return (
    <ScreenShell back={onBack} title={t('safety.title')}>
      {loadFailed && <Text style={[styles.note, styles.noteError]}>{t('safety.loadFailed')}</Text>}

      {hasContacts && <View style={[styles.card, shadows.soft]}>
        <Text style={styles.cardTitle}>{t('safety.savedTitle')}</Text>
        {saved.map((contact, index) => (
          <View key={contact.id} style={[styles.row, index < saved.length - 1 && styles.rowDivider]}>
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={1}>{contact.contactName}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{contact.phoneNumber}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('safety.remove')} onPress={() => confirmRemove(contact)} style={styles.trashButton}>
              <Text style={styles.trashText}>🗑</Text>
            </Pressable>
          </View>
        ))}
      </View>}

      {hasContacts && <PrimaryButton label={t('safety.addContact')} onPress={openAddFlow} />}

      {!hasContacts && permission === 'granted' && !loadFailed && (
        <View style={[styles.card, shadows.soft]}>
          <Text style={styles.cardTitle}>{t('safety.introTitle')}</Text>
          <Text style={styles.cardText}>{t('safety.intro')}</Text>
          <PrimaryButton label={t('safety.pickAction')} onPress={openPicker} />
        </View>
      )}

      {!hasContacts && permission === 'undetermined' && (
        <View style={[styles.card, shadows.soft]}>
          <Text style={styles.cardTitle}>{t('safety.introTitle')}</Text>
          <Text style={styles.cardText}>{t('safety.intro')}</Text>
          <PrimaryButton label={t('safety.allow')} onPress={() => void requestAccess()} />
          <Pressable accessibilityRole="button" onPress={() => setMode('overview')} style={styles.linkWrap}>
            <Text style={styles.linkText}>{t('safety.manual')}</Text>
          </Pressable>
        </View>
      )}

      {!hasContacts && permission === 'denied' && (
        <View style={[styles.card, shadows.soft]}>
          <Text style={styles.cardTitle}>{t('safety.deniedTitle')}</Text>
          <Text style={styles.cardText}>{t('safety.denied')}</Text>
          <PrimaryButton label={t('safety.openSettings')} onPress={() => void Linking.openSettings()} />
        </View>
      )}

      {!hasContacts && (
        <View style={[styles.card, shadows.soft]}>
          <Text style={styles.cardTitle}>{t('safety.manualTitle')}</Text>
          <TextInput value={manualName} onChangeText={setManualName} placeholder={t('safety.namePlaceholder')} placeholderTextColor={colors.textMuted} style={styles.input} />
          <TextInput value={manualPhone} onChangeText={setManualPhone} placeholder={t('safety.phonePlaceholder')} placeholderTextColor={colors.textMuted} keyboardType="phone-pad" style={styles.input} />
          <PrimaryButton label={saving ? t('login.pleaseWait') : t('safety.save')} onPress={saveManual} disabled={saving} />
        </View>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 12, marginBottom: 14, padding: 16 },
  cardTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '800' },
  cardText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 },
  input: { backgroundColor: colors.bg, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, fontFamily, fontSize: fontSize.md, minHeight: 48, paddingHorizontal: 12 },
  note: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, textAlign: 'center' },
  noteError: { color: colors.accent, marginBottom: 10 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 54, paddingVertical: 6 },
  rowDivider: { borderColor: colors.border, borderTopWidth: 1 },
  rowName: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  rowSub: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, marginTop: 1 },
  rowText: { flex: 1 },
  trashButton: { alignItems: 'center', height: 40, justifyContent: 'center', width: 40 },
  trashText: { fontSize: 18 },
  plusButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 999, height: 38, justifyContent: 'center', width: 38 },
  plusButtonAdded: { backgroundColor: colors.primaryLight },
  plusText: { color: colors.textOnPrimary, fontSize: 22, fontWeight: '900' },
  plusTextAdded: { color: colors.primaryDark },
  linkWrap: { alignItems: 'center', paddingVertical: 6 },
  linkText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
});
