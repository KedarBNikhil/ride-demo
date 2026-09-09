import React, { useState } from 'react';
import { Share, StyleSheet, Text } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenShell } from '../components/ScreenShell';
import { useDialog } from '../components/ThemedDialog';
import { rideLiveShareService } from '../services/rideLiveShare';
import { colors, fontFamily, fontSize } from '../theme';

export function LiveRideShareScreen({ rideId, onBack }: { rideId: string; onBack: () => void }) {
  const [sharing, setSharing] = useState(false); const dialog = useDialog();
  const share = async () => { if (sharing) return; setSharing(true); try { const { token } = await rideLiveShareService.createToken(rideId); await Share.share({ message: `Follow this live Sawaari ride in the app: ${rideLiveShareService.shareUrl(token)}`, title: 'Share live ride status' }); } catch { dialog({ title: 'Share live ride status', message: 'Could not create the live sharing link. Please try again.' }); } finally { setSharing(false); } };
  return <ScreenShell back={onBack} title="Share live ride status"><Text style={styles.text}>Share a time-limited link. It opens Sawaari for recipients who have the app, or sends them to Google Play.</Text><PrimaryButton label={sharing ? 'Please wait…' : 'Share live ride status'} disabled={sharing} onPress={() => void share()} /></ScreenShell>;
}
const styles = StyleSheet.create({ text: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, lineHeight: 22, marginBottom: 16 } });
