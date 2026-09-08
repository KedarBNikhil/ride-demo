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
  const [expanded, setExpanded] = useState(false);
  const settle = (next: boolean) => {
    setExpanded(next);
    onSettled?.(next, next ? sheetHeight : collapsedHeight);
  };
  const pan = useMemo(() => Gesture.Pan().activeOffsetY([-8, 8]).failOffsetX([-24, 24]).onBegin(() => { dragStart.value = offset.value; }).onUpdate((event) => {
    if (scrollOffset.value > 1 && event.translationY > 0) return;
    offset.value = clamp(dragStart.value + event.translationY, 0, collapsedOffset);
  }).onEnd((event) => {
    const next = event.velocityY < -350 || (event.velocityY <= 350 && offset.value < collapsedOffset / 2);
    offset.value = withSpring(next ? 0 : collapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
    runOnJS(settle)(next);
  }), [collapsedOffset, dragStart, offset, scrollOffset]);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const onScroll = useAnimatedScrollHandler({ onScroll: (event) => { scrollOffset.value = Math.max(0, event.contentOffset.y); } });
  return <Animated.View style={[styles.sheet, { bottom, height: sheetHeight }, style, animatedStyle]}>
    <GestureDetector gesture={pan}><View style={styles.dragSurface}><View style={styles.handle} /></View></GestureDetector>
    <Animated.ScrollView nestedScrollEnabled contentContainerStyle={[styles.content, contentContainerStyle]} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>{children}</Animated.ScrollView>
  </Animated.View>;
}

const styles = StyleSheet.create({ sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, left: 0, overflow: 'hidden', position: 'absolute', right: 0 }, dragSurface: { alignItems: 'center', minHeight: 42, paddingTop: 12 }, handle: { backgroundColor: colors.border, borderRadius: 3, height: 5, width: 42 }, content: { flexGrow: 1, paddingBottom: 24, paddingHorizontal: 22 } });
