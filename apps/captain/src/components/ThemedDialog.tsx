import React, { createContext, useCallback, useContext, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, fontFamily, fontSize, radii, shadows } from '../theme';

export type DialogButton = { text: string; style?: 'cancel' | 'default' | 'destructive'; onPress?: () => void };
export type DialogOptions = { title: string; message?: string; buttons?: DialogButton[] };

type ShowDialog = (options: DialogOptions) => void;

const DialogContext = createContext<ShowDialog | null>(null);

export function useDialog(): ShowDialog {
  const show = useContext(DialogContext);
  if (!show) throw new Error('DIALOG_PROVIDER_MISSING');
  return show;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<DialogOptions | null>(null);

  const show = useCallback<ShowDialog>((next) => setOptions(next), []);
  const close = (button?: DialogButton) => {
    setOptions(null);
    button?.onPress?.();
  };

  const buttons: DialogButton[] = options?.buttons?.length ? options.buttons : [{ text: t('actions.done') }];

  return (
    <DialogContext.Provider value={show}>
      {children}
      <Modal visible={options !== null} transparent animationType="fade" onRequestClose={() => close()} statusBarTranslucent>
        <Pressable style={styles.overlay} accessibilityRole="button" onPress={() => close()}>
          <Pressable onPress={(event) => event.stopPropagation()} style={[styles.card, shadows.card]}>
            <Text style={styles.title}>{options?.title}</Text>
            {options?.message ? <Text style={styles.message}>{options.message}</Text> : null}
            <View style={styles.buttons}>
              {buttons.map((button, index) => (
                <Pressable
                  key={`${button.text}-${index}`}
                  accessibilityRole="button"
                  onPress={() => close(button)}
                  style={styles.button}
                >
                  <Text style={[styles.buttonText, button.style === 'destructive' && styles.buttonDestructive, button.style === 'cancel' && styles.buttonCancel]}>
                    {button.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </DialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: 'center', backgroundColor: 'rgba(23, 26, 24, 0.55)', flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl, borderWidth: 1, overflow: 'hidden', width: '100%' },
  title: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900', paddingHorizontal: 22, paddingTop: 22 },
  message: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20, paddingHorizontal: 22, paddingTop: 8 },
  buttons: { marginTop: 18 },
  button: { alignItems: 'center', borderColor: colors.border, borderTopWidth: 1, minHeight: 52, justifyContent: 'center', paddingHorizontal: 22 },
  buttonText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  buttonDestructive: { color: colors.accent, fontWeight: '900' },
  buttonCancel: { color: colors.textSecondary, fontWeight: '700' },
});
