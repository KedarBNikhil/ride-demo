import React, { useMemo, useState } from 'react';
import { StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { clamp, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { colors, radii } from '../theme';

/** OTA-safe shared sheet used only by map-state panels. */
export function DraggableMapSheet({ children, bottom = 0, collapsedHeight = 250, maxHeight = 680, style, contentContainerStyle, onSettled }: {
  children: React.ReactNode;
  bottom?: number;
  collapsedHeight?: number;
  maxHeight?: number;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  onSettled?: (expanded: boolean, visibleHeight: number) => void;
}) {
  const { height } = useWindowDimensions();
  const sheetHeight = Math.min(maxHeight, Math.max(collapsedHeight, height - bottom - 64));
  const collapsedOffset = Math.max(0, sheetHeight - collapsedHeight);
  const offset = useSharedValue(collapsedOffset);
  const dragStart = useSharedValue(collapsedOffset);
  const scrollOffset = useSharedValue(0);
  const canDrag = useSharedValue(true);
  const [expanded, setExpanded] = useState(false);
  const settle = (next: boolean) => {
    setExpanded(next);
    onSettled?.(next, next ? sheetHeight : collapsedHeight);
  };
  const pan = useMemo(() => Gesture.Pan().activeOffsetY([-8, 8]).failOffsetX([-24, 24]).onBegin(() => {
    // A drag may begin anywhere on the sheet. Once its content has been
    // scrolled, leave that gesture to the ScrollView until it returns to top.
    canDrag.value = scrollOffset.value <= 1;
    dragStart.value = offset.value;
  }).onUpdate((event) => {
    if (!canDrag.value) return;
    offset.value = clamp(dragStart.value + event.translationY, 0, collapsedOffset);
  }).onEnd((event) => {
    if (!canDrag.value) return;
    const next = event.velocityY < -350 || (event.velocityY <= 350 && offset.value < collapsedOffset / 2);
    offset.value = withSpring(next ? 0 : collapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
    runOnJS(settle)(next);
  }), [canDrag, collapsedOffset, dragStart, offset, scrollOffset]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const onScroll = useAnimatedScrollHandler({ onScroll: (event) => { scrollOffset.value = Math.max(0, event.contentOffset.y); } });
  const nativeScroll = useMemo(() => Gesture.Native(), []);
  return <Animated.View style={[styles.sheet, { bottom, height: sheetHeight }, style, animatedStyle]}>
    <GestureDetector gesture={Gesture.Simultaneous(pan, nativeScroll)}><View style={styles.gestureRoot} collapsable={false}>
      <View style={styles.dragSurface}><View style={styles.handle} /></View>
      <Animated.ScrollView nestedScrollEnabled contentContainerStyle={[styles.content, contentContainerStyle]} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>{children}</Animated.ScrollView>
    </View></GestureDetector>
  </Animated.View>;
}

const styles = StyleSheet.create({ sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, left: 0, overflow: 'hidden', position: 'absolute', right: 0 }, gestureRoot: { flex: 1 }, dragSurface: { alignItems: 'center', minHeight: 42, paddingTop: 12 }, handle: { backgroundColor: colors.border, borderRadius: 3, height: 5, width: 42 }, content: { flexGrow: 1, paddingBottom: 24, paddingHorizontal: 22 } });
