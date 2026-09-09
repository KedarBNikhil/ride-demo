import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { supabase } from '../lib/supabase';
import { colors, fontFamily, fontSize, radii } from '../theme';

type Tracking = { state: 'inactive' | 'in_progress' | 'completed' | 'cancelled'; pickup_address?: string; drop_address?: string; last_updated_at?: string };

export function LiveRideTrackingScreen({ token, onClose }: { token: string; onClose: () => void }) {
  const [tracking, setTracking] = useState<Tracking>({ state: 'inactive' });
  const refresh = useCallback(() => {
    if (!supabase || !/^[0-9a-f]{64}$/i.test(token)) { setTracking({ state: 'inactive' }); return; }
    void supabase.rpc('public_live_ride_tracking', { p_token: token }).then(({ data }) => setTracking(data && typeof data === 'object' ? data as Tracking : { state: 'inactive' }), () => setTracking({ state: 'inactive' }));
  }, [token]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 15_000); return () => clearInterval(timer); }, [refresh]);
  const message = tracking.state === 'completed' ? 'This ride has completed.' : tracking.state === 'cancelled' ? 'This ride was cancelled.' : 'This live ride link is no longer active.';
  return <ScreenShell back={onClose} title="Live ride">{tracking.state !== 'in_progress' ? <Text style={styles.message}>{message}</Text> : <View style={styles.card}><Text style={styles.status}>Ride in progress</Text><Text style={styles.label}>From</Text><Text style={styles.value}>{tracking.pickup_address ?? '—'}</Text><Text style={styles.label}>To</Text><Text style={styles.value}>{tracking.drop_address ?? '—'}</Text><Text style={styles.note}>This status refreshes automatically. The link expires when the ride ends.</Text></View>}</ScreenShell>;
}
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: 6, padding: 18 }, status: { color: colors.success, fontFamily, fontSize: fontSize.lg, fontWeight: '800', marginBottom: 8 }, label: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, marginTop: 8 }, value: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '700' }, note: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 19, marginTop: 14 }, message: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, lineHeight: 23 } });
