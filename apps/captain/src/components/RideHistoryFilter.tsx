import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RideHistoryFilter } from '../utils/rideHistory';
import { colors, fontFamily, fontSize, radii } from '../theme';
import { selectionHaptic } from '../utils/haptics';

const options: RideHistoryFilter[] = ['all', 'date', 'month', 'year'];

export function RideHistoryFilterControl({ value, onChange }: { value: RideHistoryFilter; onChange: (value: RideHistoryFilter) => void }) {
  const { t } = useTranslation();
  return <View style={styles.filters}>{options.map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: value === option }} onPress={() => { selectionHaptic(); onChange(option); }} style={[styles.filter, value === option && styles.filterSelected]}><Text style={[styles.filterText, value === option && styles.filterTextSelected]}>{t(`history.${option}`)}</Text></Pressable>)}</View>;
}

const styles = StyleSheet.create({ filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, filter: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, minHeight: 36, paddingHorizontal: 13, justifyContent: 'center' }, filterSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary }, filterText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, fontWeight: '700' }, filterTextSelected: { color: colors.primaryDark, fontWeight: '900' } });
