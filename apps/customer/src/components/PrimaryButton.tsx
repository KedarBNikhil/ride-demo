import React from 'react';
import { Pressable, StyleSheet, Text, Animated } from 'react-native';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';
import { selectionHaptic } from '../utils/haptics';

type Props = {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  small?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
  small = false,
}: Props) {
  const scale = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40 }).start();
  };
  const handlePress = () => {
    if (disabled) return;
    selectionHaptic();
    onPress();
  };

  const containerStyle = [
    styles.button,
    small && styles.buttonSmall,
    secondary && styles.secondary,
    danger && styles.danger,
    disabled && styles.disabled,
    !secondary && !danger && !disabled && shadows.button,
  ];

  const textStyle = [
    styles.label,
    small && styles.labelSmall,
    secondary && styles.secondaryLabel,
    danger && styles.dangerLabel,
    disabled && styles.disabledLabel,
  ];

  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View style={[containerStyle, { transform: [{ scale }] }]}>
        <Text style={textStyle}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 4,
  },
  buttonSmall: {
    minHeight: 44,
    paddingHorizontal: 18,
  },
  secondary: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  danger: {
    backgroundColor: colors.errorLight,
    borderWidth: 1.5,
    borderColor: colors.error,
  },
  disabled: {
    backgroundColor: colors.disabled,
  },
  label: {
    color: colors.textOnPrimary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '800',
    textAlign: 'center',
  },
  labelSmall: {
    fontSize: fontSize.md,
  },
  secondaryLabel: {
    color: colors.primary,
  },
  dangerLabel: {
    color: colors.error,
  },
  disabledLabel: {
    color: colors.textDisabled,
  },
});
