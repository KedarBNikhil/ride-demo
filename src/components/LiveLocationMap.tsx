import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { colors } from '../theme';
export type LiveCoordinate = { latitude: number; longitude: number };
const NANDYAL: Region = { latitude: 15.4889, longitude: 78.4836, latitudeDelta: 0.035, longitudeDelta: 0.035 };
// Expo Go has no project-specific native Maps key; installed development builds
// do, even when Metro on the developer machine does not have the public env var.
const canMountGoogleMap = Constants.executionEnvironment !== 'storeClient';
/** Shared foreground-location map display for both rider and captain home experiences. */
export function LiveLocationMap({ mapRef, location, onMapReady, children }: { mapRef: React.RefObject<MapView | null>; location: LiveCoordinate | null; onMapReady?: () => void; children?: React.ReactNode }) {
  if (!canMountGoogleMap) return <View style={styles.fallback}><View style={styles.dot} /><Text style={styles.fallbackText}>Location is active. Map preview is unavailable in Expo Go.</Text></View>;
  return <MapView ref={mapRef} provider={PROVIDER_GOOGLE} initialRegion={NANDYAL} onMapReady={onMapReady} style={StyleSheet.absoluteFill}>{location && <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.dot} /></Marker>}{children}</MapView>;
}
const styles = StyleSheet.create({ fallback: { alignItems: 'center', backgroundColor: '#E8F3EF', flex: 1, justifyContent: 'center', padding: 28 }, fallbackText: { color: colors.textSecondary, fontSize: 15, marginTop: 12, textAlign: 'center' }, dot: { backgroundColor: colors.success, borderColor: '#FFFFFF', borderRadius: 14, borderWidth: 3, height: 28, width: 28 } });
