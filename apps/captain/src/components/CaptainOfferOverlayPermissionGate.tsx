import { AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';
import { canUseCaptainOfferOverlayControls, isCaptainOfferOverlayAllowed, openCaptainOfferOverlaySettings } from '../services/directCaptainRideOffers';
import { colors, fontFamily, radii } from '../theme';

/** Overlay access is required for approved Captains so an actionable ride card
 * remains visible while they are navigating in another app. Android itself
 * owns the final special-access switch; an app cannot grant it silently. */
export function CaptainOfferOverlayPermissionGate({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const controlsAvailable = canUseCaptainOfferOverlayControls();
  const refresh = () => { void isCaptainOfferOverlayAllowed().then(setAllowed).catch(() => setAllowed(false)); };
  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => subscription.remove();
  }, []);
  if (Platform.OS !== 'android' || !controlsAvailable || allowed) return <>{children}</>;
  if (allowed === null) return null;
  return <View style={styles.page}><View style={styles.card}><Text style={styles.title}>Enable ride request display</Text><Text style={styles.message}>To receive and respond to ride requests while using Maps or another app, allow Sawaari Captain to display over other apps.</Text><Pressable accessibilityRole="button" onPress={openCaptainOfferOverlaySettings} style={styles.button}><Text style={styles.buttonText}>Enable now</Text></Pressable><Text style={styles.note}>On the next screen, switch on “Allow display over other apps”, then return here.</Text></View></View>;
}

const styles = StyleSheet.create({ page: { alignItems: 'center', backgroundColor: colors.bg, flex: 1, justifyContent: 'center', padding: 24 }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.xl, borderWidth: 1, gap: 16, padding: 24, width: '100%' }, title: { color: colors.textPrimary, fontFamily, fontSize: 22, fontWeight: '900', textAlign: 'center' }, message: { color: colors.textSecondary, fontFamily, fontSize: 16, lineHeight: 24, textAlign: 'center' }, button: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: radii.md, minHeight: 54, justifyContent: 'center' }, buttonText: { color: colors.textOnPrimary, fontFamily, fontSize: 16, fontWeight: '900' }, note: { color: colors.textMuted, fontFamily, fontSize: 13, lineHeight: 19, textAlign: 'center' } });
