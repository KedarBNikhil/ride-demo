import { Image, StyleSheet, View } from 'react-native';

const selectedRidePattern = require('../../assets/images/ndl-ride-pattern-clean.png');

/** The selected watercolor/block-print pattern used behind quiet app screens. */
export function NandyalBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Image
        accessibilityIgnoresInvertColors
        resizeMode="cover"
        source={selectedRidePattern}
        style={styles.pattern}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pattern: {
    ...StyleSheet.absoluteFillObject,
    height: '100%',
    opacity: 0.22,
    width: '100%',
  },
});
