import React, { useEffect, useRef, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { colors } from '../theme';
export type LiveCoordinate = { latitude: number; longitude: number };
const NANDYAL: Region = { latitude: 15.4889, longitude: 78.4836, latitudeDelta: 0.035, longitudeDelta: 0.035 };
// Expo Go has no project-specific native Maps key; installed development builds
// do, even when Metro on the developer machine does not have the public env var.
const canMountGoogleMap = Constants.executionEnvironment !== 'storeClient';
export function LiveLocationMarker({ coordinate }: { coordinate: LiveCoordinate }) {
  return <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.dot} /></Marker>;
}
/** Shared map display. Coordinates are supplied only by manual ride selection. */
export function LiveLocationMap({ mapRef, location, onMapReady, pickupHereLabel, onPickupHere, locationResetToken = 0, children }: { mapRef: React.RefObject<MapView | null>; location: LiveCoordinate | null; onMapReady?: () => void; pickupHereLabel?: string; onPickupHere?: (coordinate: LiveCoordinate) => void; locationResetToken?: number; children?: React.ReactNode }) {
  const [pickupPoint, setPickupPoint] = useState<{ x: number; y: number } | null>(null);
  const pickupWasMoved = useRef(false);
  const anchorOnNextRegionChange = useRef(false);
  const updatePickupPoint = async () => {
    if (!location || !onPickupHere || !mapRef.current) return setPickupPoint(null);
    try {
      const nextPoint = await mapRef.current.pointForCoordinate(location);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setPickupPoint(nextPoint);
    } catch { setPickupPoint(null); }
  };
  useEffect(() => {
    if (pickupWasMoved.current || pickupPoint) return;
    const frame = requestAnimationFrame(() => { void updatePickupPoint(); });
    return () => cancelAnimationFrame(frame);
  }, [location?.latitude, location?.longitude, onPickupHere, pickupPoint]);
  useEffect(() => { pickupWasMoved.current = false; anchorOnNextRegionChange.current = true; }, [locationResetToken]);
  const choosePickup = async () => {
    if (!location || !onPickupHere) return;
    if (!pickupWasMoved.current || !pickupPoint || !mapRef.current) return onPickupHere(location);
    try { onPickupHere(await mapRef.current.coordinateForPoint(pickupPoint)); } catch { onPickupHere(location); }
  };
  if (!canMountGoogleMap) return <View style={styles.fallback}>{location && <View style={styles.markerWrap}>{onPickupHere && <Pressable onPress={() => onPickupHere(location)} accessibilityRole="button" style={styles.pickupHere}><Text style={styles.pickupHereText}>{pickupHereLabel}</Text></Pressable>}<View style={styles.dot} /></View>}<Text style={styles.fallbackText}>Map preview is unavailable in Expo Go.</Text></View>;
  return <View style={StyleSheet.absoluteFill}><MapView ref={mapRef} provider={PROVIDER_GOOGLE} initialRegion={NANDYAL} scrollDuringRotateOrZoomEnabled={false} onMapReady={() => { onMapReady?.(); requestAnimationFrame(() => { void updatePickupPoint(); }); }} onPanDrag={() => { pickupWasMoved.current = true; anchorOnNextRegionChange.current = false; }} onRegionChangeComplete={() => { if (anchorOnNextRegionChange.current) { anchorOnNextRegionChange.current = false; void updatePickupPoint(); } }} style={StyleSheet.absoluteFill}>{location && <LiveLocationMarker coordinate={location} />}{children}</MapView>{pickupPoint && onPickupHere && <View style={[styles.mapPickupAnchor, { left: Math.max(8, pickupPoint.x - 58), top: Math.max(8, pickupPoint.y - 46) }]}><Pressable onPress={choosePickup} accessibilityRole="button" style={styles.mapPickupHere}><Text style={styles.pickupHereText}>{pickupHereLabel}</Text></Pressable><View style={styles.mapPickupPointer} /></View>}</View>;
}
const styles = StyleSheet.create({ fallback: { alignItems: 'center', backgroundColor: colors.primaryLight, flex: 1, justifyContent: 'center', padding: 28 }, fallbackText: { color: colors.textSecondary, fontSize: 15, marginTop: 12, textAlign: 'center' }, markerWrap: { alignItems: 'center' }, pickupHere: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: 99, justifyContent: 'center', marginBottom: 8, minHeight: 30, paddingHorizontal: 11 }, mapPickupAnchor: { alignItems: 'center', position: 'absolute', width: 116, zIndex: 5 }, mapPickupHere: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.primaryDark, borderRadius: 99, elevation: 5, justifyContent: 'center', minHeight: 30, paddingHorizontal: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.18, shadowRadius: 4 }, mapPickupPointer: { backgroundColor: colors.primaryDark, height: 16, width: 2 }, pickupHereText: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '800', includeFontPadding: false }, dot: { backgroundColor: colors.success, borderColor: '#FFFFFF', borderRadius: 14, borderWidth: 3, height: 28, width: 28 } });
