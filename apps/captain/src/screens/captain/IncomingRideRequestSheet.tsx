import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { rideDispatchService, type CaptainRideRequest } from '../../services/rideDispatch';
import { formatFare, formatNumber } from '../../utils/format';
import { colors, fontFamilyBold, fontFamilyExtraBold, fontSize, radii, shadows } from '../../theme';
import { DraggableMapSheet } from '../../components/DraggableMapSheet';

export function IncomingRideRequestSheet({ request, onAccept, onReject, bottomOffset = 0 }: { request: CaptainRideRequest; onAccept: () => Promise<void>; onReject: () => void; bottomOffset?: number }) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((new Date(request.expiresAt).getTime() - Date.now()) / 1000)));
  const [accepting, setAccepting] = useState(false);
  const [tripDistance, setTripDistance] = useState<number | null>(request.tripDistanceMeters ?? null);
  useEffect(() => {
    setSeconds(Math.max(0, Math.ceil((new Date(request.expiresAt).getTime() - Date.now()) / 1000)));
    setAccepting(false);
  }, [request.expiresAt]);
  useEffect(() => {
    let active = true;
    setTripDistance(request.tripDistanceMeters ?? null);
    if (request.tripDistanceMeters == null) {
      void rideDispatchService.getRide(request.rideId).then((ride) => {
        if (active && ride.trip_distance_meters != null && Number.isFinite(Number(ride.trip_distance_meters))) setTripDistance(Number(ride.trip_distance_meters));
      }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [request.rideId, request.tripDistanceMeters]);
  useEffect(() => {
    if (seconds === 0) { onReject(); return; }
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds, onReject]);
  const accept = async () => {
    if (accepting) return;
    setAccepting(true);
    try { await onAccept(); } finally { setAccepting(false); }
  };
  return <DraggableMapSheet bottom={bottomOffset} collapsedHeight={Math.min(440, height - bottomOffset - 64)} style={[shadows.card, styles.overlay]}>
    <View style={styles.heading}>
      <View style={styles.headingContent}><Text style={styles.title}>{t('captain.requestTitle')}</Text><Text style={styles.fare}>{formatFare(request.fare)}</Text></View>
      <View style={styles.timer}><Text style={styles.timerNumber}>{formatNumber(seconds)}</Text><Text style={styles.timerLabel}>{t('captain.seconds')}</Text></View>
    </View>
    <View style={styles.route}>
      <View style={styles.rail}><View style={styles.dot} /><View style={styles.line} /><Text style={styles.arrow}>▼</Text></View>
      <View style={styles.stops}>
        <View><Text style={styles.distance}>{t('captain.pickup')} · {formatNumber(request.distanceKm, { maximumFractionDigits: 2 })} km</Text><Text style={styles.address} numberOfLines={2}>{request.pickupArea}</Text></View>
        <View><Text style={styles.distance}>{t('captain.drop')} · {tripDistance == null ? t('captain.distanceUnavailable') : `${formatNumber(tripDistance / 1000, { maximumFractionDigits: 2 })} km`}</Text><Text style={styles.address} numberOfLines={2}>{request.destinationArea}</Text></View>
      </View>
    </View>
    <View style={styles.actions}><Pressable disabled={accepting} onPress={onReject} style={[styles.reject, accepting && styles.disabled]}><Text style={styles.rejectText}>{t('captain.rejectRide')}</Text></Pressable><Pressable disabled={accepting} onPress={() => { void accept(); }} style={[styles.accept, accepting && styles.disabled]}><Text style={styles.acceptText}>{t('captain.accept')}</Text></Pressable></View>
  </DraggableMapSheet>;
}
const styles = StyleSheet.create({
  overlay: { elevation: 100, zIndex: 100 }, heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, headingContent: { flex: 1 },
  title: { color: colors.textPrimary, fontFamily: fontFamilyBold, fontSize: fontSize.md }, fare: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: 32, marginTop: 2 },
  timer: { alignItems: 'center', backgroundColor: colors.accentLight, borderRadius: radii.md, minWidth: 58, padding: 7 }, timerNumber: { color: colors.accent, fontFamily: fontFamilyExtraBold, fontSize: fontSize.xl }, timerLabel: { color: colors.accent, fontFamily: fontFamilyBold, fontSize: fontSize.xs },
  route: { flexDirection: 'row', marginTop: 10, marginBottom: 14 }, rail: { alignItems: 'center', width: 18, paddingTop: 7, paddingBottom: 29 }, dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.textPrimary }, line: { width: 2, flex: 1, backgroundColor: colors.textPrimary }, arrow: { color: colors.textPrimary, fontSize: 12, lineHeight: 12 }, stops: { flex: 1, gap: 12, paddingLeft: 7 }, distance: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md }, address: { color: colors.textPrimary, fontFamily: fontFamilyBold, fontSize: fontSize.sm, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 10 }, reject: { alignItems: 'center', backgroundColor: colors.errorLight, borderRadius: radii.pill, flex: 1, justifyContent: 'center', minHeight: 54 }, rejectText: { color: colors.error, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md }, accept: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.pill, flex: 1, justifyContent: 'center', minHeight: 54 }, acceptText: { color: colors.textOnPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md }, disabled: { opacity: 0.6 },
});
