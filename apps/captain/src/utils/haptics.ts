import { Platform, Vibration } from 'react-native';

/** Lightweight feedback for enabled, user-initiated controls. */
export function selectionHaptic() {
  if (Platform.OS === 'android') Vibration.vibrate(10);
}
