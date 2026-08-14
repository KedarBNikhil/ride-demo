import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { colors } from '../theme';
export type LiveCoordinate = { latitude: number; longitude: number };
const NANDYAL: Region = { latitude: 15.4889, longitude: 78.4836, latitudeDelta: 0.035, longitudeDelta: 0.035 };
/** Shared foreground-location map display for both rider and captain home experiences. */
export function LiveLocationMap({ mapRef, location, onMapReady, children }: { mapRef: React.RefObject<MapView | null>; location: LiveCoordinate | null; onMapReady?: () => void; children?: React.ReactNode }) { return <MapView ref={mapRef} provider={PROVIDER_GOOGLE} initialRegion={NANDYAL} onMapReady={onMapReady} style={StyleSheet.absoluteFill}>{location && <Marker coordinate={location} anchor={{ x: 0.5, y: 0.5 }}><View style={styles.dot} /></Marker>}{children}</MapView>; }
const styles = StyleSheet.create({ dot: { backgroundColor: colors.success, borderColor: '#FFFFFF', borderRadius: 14, borderWidth: 3, height: 28, width: 28 } });
