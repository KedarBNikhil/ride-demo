import { useFonts, NotoSansTelugu_400Regular, NotoSansTelugu_700Bold, NotoSansTelugu_800ExtraBold } from '@expo-google-fonts/noto-sans-telugu';
import { StatusBar } from 'expo-status-bar';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRef } from 'react';
import { useState } from 'react';
import { AppNavigator, type AppMode } from './src/navigation/AppNavigator';
import { appVariant, isSeparateApp } from './src/config/appVariant';
import { colors, radii, shadows, fontFamily, fontSize } from './src/theme';
import { NandyalBackdrop } from './src/components/NandyalBackdrop';

export default function App() {
  const [fontsLoaded] = useFonts({
    NotoSansTelugu: NotoSansTelugu_400Regular,
    'NotoSansTelugu-Bold': NotoSansTelugu_700Bold,
    'NotoSansTelugu-ExtraBold': NotoSansTelugu_800ExtraBold,
  });
  const initialMode: AppMode | null = isSeparateApp ? (appVariant === 'captain' ? 'captain' : appVariant === 'operator' ? 'operator' : 'customer') : null;
  const [mode, setMode] = useState<AppMode | null>(initialMode);
  const [flowVersion, setFlowVersion] = useState(0);
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {mode ? (
        <AppNavigator key={`${mode}-${flowVersion}`} mode={mode} onExit={() => { if (isSeparateApp) setFlowVersion((value) => value + 1); else setMode(null); }} />
      ) : (
        <ModeLauncher onChoose={setMode} />
      )}
    </SafeAreaProvider>
  );
}

function RoleCard({
  icon,
  title,
  subtitle,
  onPress,
  tinted,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  tinted?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const handlePressIn = () =>
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50 }).start();
  const handlePressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start();

  return (
    <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <Animated.View
        style={[
          styles.roleCard,
          tinted && styles.roleCardTinted,
          shadows.card,
          { transform: [{ scale }] },
        ]}
      >
        <View style={[styles.roleIconBadge, tinted && styles.roleIconBadgeTinted]}>
          <Text style={styles.roleIcon}>{icon}</Text>
        </View>
        <View style={styles.roleTextWrap}>
          <Text style={styles.roleTitle}>{title}</Text>
          <Text style={styles.roleSubtitle}>{subtitle}</Text>
        </View>
        <Text style={[styles.roleArrow, tinted && styles.roleArrowTinted]}>›</Text>
      </Animated.View>
    </Pressable>
  );
}

function ModeLauncher({ onChoose }: { onChoose: (mode: AppMode) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.page}>
      <NandyalBackdrop />
      {/* Hero gradient strip */}
      <View style={[styles.hero, { paddingTop: 56 + (insets?.top ?? 0) }]}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroEmoji}>🛺</Text>
        </View>
        <Text style={styles.brand}>Nandyal Ride</Text>
        <Text style={styles.tagline}>Your local ride, your community</Text>
      </View>

      {/* Role picker */}
      <View style={styles.roles}>
        <Text style={styles.rolesLabel}>Choose your experience</Text>
        <RoleCard
          icon="🙋"
          title="Customer"
          subtitle="Book a ride in seconds"
          onPress={() => onChoose('customer')}
        />
        <RoleCard
          icon="🏍️"
          title="Captain"
          subtitle="Accept rides & earn"
          onPress={() => onChoose('captain')}
          tinted
        />
      </View>

      {/* Footer */}
      <Text style={styles.footer}>Serving Nandyal &amp; surrounding areas</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Hero
  hero: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    paddingTop: 56,
    paddingBottom: 40,
    paddingHorizontal: 24,
  },
  heroBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radii.xl,
    height: 96,
    justifyContent: 'center',
    marginBottom: 18,
    width: 96,
  },
  heroEmoji: {
    fontSize: 50,
  },
  brand: {
    color: colors.textOnPrimary,
    fontFamily,
    fontSize: fontSize['3xl'],
    fontWeight: '900',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  tagline: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily,
    fontSize: fontSize.sm,
    marginTop: 10,
    textAlign: 'center',
  },

  // Roles
  roles: {
    flex: 1,
    gap: 14,
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  rolesLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  roleCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    flexDirection: 'row',
    gap: 14,
    padding: 18,
  },
  roleCardTinted: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  roleIconBadge: {
    alignItems: 'center',
    backgroundColor: colors.bgAlt,
    borderRadius: radii.md,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  roleIconBadgeTinted: {
    backgroundColor: colors.primary,
  },
  roleIcon: {
    fontSize: 26,
  },
  roleTextWrap: {
    flex: 1,
    gap: 3,
  },
  roleTitle: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  roleSubtitle: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
  },
  roleArrow: {
    color: colors.textMuted,
    fontSize: 26,
    fontWeight: '300',
  },
  roleArrowTinted: {
    color: colors.primary,
  },

  // Footer
  footer: {
    color: colors.textMuted,
    fontFamily,
    fontSize: 12,
    marginBottom: 24,
    textAlign: 'center',
  },
});
