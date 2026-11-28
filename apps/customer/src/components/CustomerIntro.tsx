import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { colors, fontFamilyExtraBold } from '../theme';

const SIZE = 190;
const AREA = 300;

function Wheel({ color }: { color: string }) {
  return <Svg width={SIZE} height={SIZE} viewBox="0 0 200 200">
    <Circle cx="100" cy="100" r="88" stroke={color} strokeWidth="7" fill="none" />
    <Circle cx="100" cy="100" r="80" stroke={color} strokeWidth="3" fill="none" />
    {[[100,20,100,180],[20,100,180,100],[43.4,43.4,156.6,156.6],[156.6,43.4,43.4,156.6]].map((line, index) =>
      <Line key={index} x1={line[0]} y1={line[1]} x2={line[2]} y2={line[3]} stroke={color} strokeWidth="5" strokeLinecap="round" />)}
  </Svg>;
}

export function CustomerIntro({ onComplete }: { onComplete: () => void }) {
  const reveal = useRef(new Animated.Value(0)).current;
  const move = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const [row, setRow] = useState<{ x: number; y: number } | null>(null);
  const [letter, setLetter] = useState<{ x: number; width: number } | null>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;

  useEffect(() => {
    if (!row || !letter) return;
    const animation = Animated.sequence([
      Animated.timing(reveal, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(950),
      Animated.timing(move, { toValue: 1, duration: 1050, easing: Easing.bezier(.35, 0, .2, 1), useNativeDriver: true }),
      Animated.delay(500),
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => { if (finished) complete.current(); });
    return () => animation.stop();
  }, [row, letter, reveal, move, fade]);

  const dx = (row?.x ?? 0) + (letter?.x ?? 0) + (letter?.width ?? 0) / 2 - AREA / 2;
  const dy = (row?.y ?? 0) + 5 - AREA / 2;
  const travel = { transform: [
    { translateX: move.interpolate({ inputRange: [0, .7, 1], outputRange: [0, dx * .55, dx] }) },
    { translateY: move.interpolate({ inputRange: [0, .7, 1], outputRange: [0, dy - 32, dy] }) },
    { rotate: move.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
    { scale: Animated.multiply(reveal.interpolate({ inputRange: [0, 1], outputRange: [.55, 1] }), move.interpolate({ inputRange: [0, .7, 1], outputRange: [1, .25, .07] })) },
  ] };
  return <Animated.View style={[styles.screen, { opacity: fade }]} accessibilityLabel="Sawaari. Your local ride. Made with love from Nandyal.">
    <View style={styles.area}>
      <Animated.View style={[styles.orb, { opacity: Animated.multiply(reveal, move.interpolate({ inputRange: [0, .45], outputRange: [1, 0], extrapolate: 'clamp' })), transform: [{ scale: reveal }] }]} />
      <Animated.View style={[styles.wheel, travel, { opacity: reveal }]}>
        <Wheel color="#b6e9c4" />
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: move }]}><Wheel color="#25964c" /></Animated.View>
      </Animated.View>
      <View style={styles.brand} onLayout={event => { const { x, y } = event.nativeEvent.layout; setRow(previous => previous?.x === x && previous.y === y ? previous : { x, y }); }}>
        <View style={styles.row}>
          <Animated.Text style={[styles.word, { opacity: reveal }]}>Sawaar</Animated.Text>
          <Animated.Text onLayout={event => { const { x, width } = event.nativeEvent.layout; setLetter(previous => previous?.x === x && previous.width === width ? previous : { x, width }); }} style={[styles.word, styles.letter, { opacity: reveal }]}>ı</Animated.Text>
        </View>
        <Animated.Text style={[styles.tag, { opacity: reveal }]}>YOUR LOCAL RIDE!</Animated.Text>
      </View>
    </View>
    <Text style={styles.bottom}>MADE WITH <Text style={styles.heart}>♥</Text> FROM NANDYAL</Text>
  </Animated.View>;
}

const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  area: { width: AREA, height: AREA, alignItems: 'center', justifyContent: 'center' },
  orb: { position: 'absolute', width: 112, height: 112, borderRadius: 56, backgroundColor: colors.surfaceMint },
  wheel: { position: 'absolute', width: SIZE, height: SIZE, left: (AREA - SIZE) / 2, top: (AREA - SIZE) / 2 },
  brand: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  word: { fontFamily: fontFamilyExtraBold, fontSize: 43, lineHeight: 50, letterSpacing: -2.8, color: colors.primary, includeFontPadding: false },
  letter: { marginLeft: 1.5 },
  tag: { marginTop: 10, color: colors.textSecondary, fontFamily: fontFamilyExtraBold, fontSize: 9, letterSpacing: 1.35 },
  bottom: { position: 'absolute', bottom: 36, color: colors.textMuted, fontFamily: fontFamilyExtraBold, fontSize: 9, letterSpacing: 1 },
  heart: { color: '#e63737' },
});
