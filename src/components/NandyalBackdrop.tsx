import { StyleSheet, View } from 'react-native';

/** A quiet, code-native backdrop inspired by rangoli geometry and dry-land sunrise tones. */
export function NandyalBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={styles.sun} />
      <View style={styles.orbit} />
      <View style={[styles.dot, styles.dotOne]} />
      <View style={[styles.dot, styles.dotTwo]} />
      <View style={[styles.diamond, styles.diamondOne]} />
      <View style={[styles.diamond, styles.diamondTwo]} />
      <View style={styles.kolamLeft}>
        <View style={styles.kolamSquare} />
        <View style={styles.kolamSquare} />
        <View style={styles.kolamSquare} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sun: { backgroundColor: '#F6D79C', borderRadius: 140, height: 280, opacity: 0.28, position: 'absolute', right: -125, top: 84, width: 280 },
  orbit: { borderColor: '#0D7A6B', borderRadius: 160, borderWidth: 2, height: 320, opacity: 0.08, position: 'absolute', right: -185, top: 50, width: 320 },
  dot: { backgroundColor: '#C2410C', borderRadius: 10, height: 20, opacity: 0.16, position: 'absolute', width: 20 },
  dotOne: { left: 28, top: 180 },
  dotTwo: { bottom: 110, right: 32 },
  diamond: { backgroundColor: '#0D7A6B', height: 12, opacity: 0.12, position: 'absolute', transform: [{ rotate: '45deg' }], width: 12 },
  diamondOne: { left: 44, top: 450 },
  diamondTwo: { right: 75, top: 395 },
  kolamLeft: { bottom: 50, gap: 10, left: -28, opacity: 0.1, position: 'absolute', transform: [{ rotate: '45deg' }] },
  kolamSquare: { borderColor: '#C2410C', borderWidth: 2, height: 38, width: 38 },
});
