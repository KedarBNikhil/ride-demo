import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenShell } from '../components/ScreenShell';
import { formatFare, formatNumber } from '../utils/format';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';

const REQUEST_FARE = 85;
const DESTINATION = { latitude: 15.4921, longitude: 78.4862 };

/* ─────────────────────────── LOGIN ─────────────────────────── */

export function CaptainLoginScreen({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [error, setError] = useState('');

  const value = step === 'phone' ? phone : otp;
  const limit = step === 'phone' ? 10 : 6;

  const append = (digit: string) => {
    setError('');
    if (value.length >= limit) return;
    step === 'phone' ? setPhone(`${phone}${digit}`) : setOtp(`${otp}${digit}`);
  };
  const del = () =>
    step === 'phone' ? setPhone(phone.slice(0, -1)) : setOtp(otp.slice(0, -1));

  const submit = () => {
    if (step === 'phone') {
      if (!/^\d{10}$/.test(phone)) return setError(t('login.invalidPhone'));
      setError(''); setStep('otp');
    } else {
      if (!/^\d{4,6}$/.test(otp)) return setError(t('login.invalidOtp'));
      onComplete();
    }
  };

  return (
    <ScreenShell
      back={onBack}
      title={step === 'phone' ? t('captain.loginTitle') : t('login.otpTitle')}
    >
      <View style={styles.loginHero}>
        <Text style={styles.loginEmoji}>🏍️</Text>
        <Text style={styles.loginTitle}>
          {step === 'phone' ? t('captain.loginSubtitle') : t('login.otpSubtitle')}
        </Text>
      </View>

      <View style={[styles.inputCard, shadows.soft]}>
        <Text style={styles.inputLabel}>
          {step === 'phone' ? t('login.phoneLabel') : t('login.otpLabel')}
        </Text>
        <TextInput
          value={value}
          editable={false}
          maxLength={limit}
          placeholder={step === 'phone' ? t('login.phonePlaceholder') : t('login.otpPlaceholder')}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
      </View>

      <NumberPad onDigit={append} onDelete={del} />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton
        label={step === 'phone' ? t('login.sendOtp') : t('login.verify')}
        onPress={submit}
      />
    </ScreenShell>
  );
}

function NumberPad({ onDigit, onDelete }: { onDigit: (d: string) => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={styles.pad}>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
        <NumKey key={d} label={formatNumber(d)} onPress={() => onDigit(String(d))} />
      ))}
      <View style={styles.keyEmpty} />
      <NumKey label={formatNumber(0)} onPress={() => onDigit('0')} />
      <Pressable onPress={onDelete} style={styles.key} accessibilityRole="button">
        <Text style={styles.deleteText}>{t('actions.delete')}</Text>
      </Pressable>
    </View>
  );
}

function NumKey({ label, onPress }: { label: string; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.9, useNativeDriver: true, speed: 50 }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()
      }
    >
      <Animated.View style={[styles.key, shadows.soft, { transform: [{ scale }] }]}>
        <Text style={styles.keyText}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

/* ─────────────────────────── HOME ─────────────────────────── */

export function CaptainHomeScreen({
  online,
  onToggle,
  onSettings,
  onRequest,
}: {
  online: boolean;
  onToggle: () => void;
  onSettings: () => void;
  onRequest: () => void;
}) {
  const { t } = useTranslation();

  // Pulse animation for online state
  const pulse = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    if (!online) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulse, { toValue: 1.35, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0, duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(pulse, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [online, pulse, pulseOpacity]);

  useEffect(() => {
    if (!online) return;
    const id = setTimeout(onRequest, 7000);
    return () => clearTimeout(id);
  }, [online, onRequest]);

  return (
    <ScreenShell title={t('screens.captainHome')}>
      <Pressable onPress={onSettings} style={styles.settingsBtn}>
        <Text style={styles.settingsIcon}>⚙️</Text>
        <Text style={styles.settingsText}>{t('actions.settings')}</Text>
      </Pressable>

      {/* Status panel */}
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: online }}
        onPress={onToggle}
        style={[styles.statusPanel, online ? styles.statusOnline : styles.statusOffline]}
      >
        {/* Pulse ring */}
        {online && (
          <Animated.View
            style={[
              styles.pulseRing,
              { transform: [{ scale: pulse }], opacity: pulseOpacity },
            ]}
          />
        )}

        <Text style={styles.statusDot}>{online ? '●' : '○'}</Text>
        <Text style={styles.statusTitle}>
          {t(online ? 'captain.online' : 'captain.offline')}
        </Text>
        <Text style={styles.statusDetail}>
          {t(online ? 'captain.onlineDetail' : 'captain.offlineDetail')}
        </Text>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipText}>{t('captain.tapToChange')}</Text>
        </View>
      </Pressable>

      <Text style={styles.waiting}>
        {online ? t('captain.waiting') : t('captain.offlineDetail')}
      </Text>
    </ScreenShell>
  );
}

/* ─────────────────────────── INCOMING REQUEST ─────────────────────────── */

export function IncomingRequestScreen({
  onAccept,
  onDecline,
  onBack,
}: {
  onAccept: () => void;
  onDecline: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(15);

  useEffect(() => {
    if (seconds === 0) { onDecline(); return; }
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds, onDecline]);

  const progress = seconds / 15;

  return (
    <ScreenShell back={onBack} title={t('captain.requestTitle')}>
      {/* Countdown */}
      <View style={styles.timerCard}>
        <View style={styles.timerRingWrap}>
          <View style={[styles.timerRingBg]} />
          <View
            style={[
              styles.timerRingFill,
              {
                borderColor: progress > 0.4 ? colors.primary : colors.error,
                opacity: 0.25 + progress * 0.75,
              },
            ]}
          />
          <Text style={[styles.timerNumber, { color: progress > 0.4 ? colors.primary : colors.error }]}>
            {formatNumber(seconds)}
          </Text>
        </View>
        <Text style={styles.timerText}>
          {t('captain.requestExpires', { seconds: formatNumber(seconds) })}
        </Text>
      </View>

      <Text style={styles.instruction}>{t('captain.requestInstruction')}</Text>

      {/* Request details */}
      <View style={[styles.requestCard, shadows.card]}>
        <Detail label={t('captain.pickup')} value={t('captain.requestPickup')} icon="🟢" />
        <Detail label={t('captain.drop')} value={t('captain.requestDrop')} icon="🔴" />
        <Detail label={t('captain.rideType')} value={`🛺 ${t('captain.requestRide')}`} icon="🛺" hideIcon />
        <Detail label={t('captain.fare')} value={formatFare(REQUEST_FARE)} icon="💰" last />
      </View>

      <PrimaryButton label={t('captain.accept')} onPress={onAccept} />
      <PrimaryButton label={t('captain.decline')} onPress={onDecline} danger />
    </ScreenShell>
  );
}

/* ─────────────────────────── RIDE IN PROGRESS ─────────────────────────── */

export function RideInProgressScreen({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const navigate = () =>
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${DESTINATION.latitude},${DESTINATION.longitude}&travelmode=driving`,
    );

  return (
    <ScreenShell back={onBack} title={t('captain.inProgressTitle')}>
      {/* Status badge */}
      <View style={styles.inProgressBadge}>
        <Text style={styles.inProgressEmoji}>🚗</Text>
        <Text style={styles.inProgressLabel}>{t('captain.inProgressTitle')}</Text>
      </View>

      <View style={[styles.requestCard, shadows.card]}>
        <Detail label={t('captain.pickup')} value={t('captain.requestPickup')} icon="🟢" />
        <Detail label={t('captain.drop')} value={t('captain.requestDrop')} icon="🔴" last />
      </View>

      <PrimaryButton label={t('captain.navigate')} onPress={navigate} secondary />
      <PrimaryButton label={t('captain.complete')} onPress={onComplete} />
    </ScreenShell>
  );
}

/* ─────────────────────────── RIDE SUMMARY ─────────────────────────── */

export function RideSummaryScreen({ onHome }: { onHome: () => void }) {
  const { t } = useTranslation();

  // Pop-in animation
  const popIn = useRef(new Animated.Value(0.7)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(popIn, { toValue: 1, useNativeDriver: true, speed: 6, bounciness: 12 }),
      Animated.timing(fade, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [popIn, fade]);

  return (
    <ScreenShell back={onHome} title={t('captain.summaryTitle')}>
      <Text style={styles.summarySubtitle}>{t('captain.thanks')}</Text>

      {/* Earnings card */}
      <Animated.View
        style={[
          styles.earningsCard,
          shadows.card,
          { transform: [{ scale: popIn }], opacity: fade },
        ]}
      >
        <Text style={styles.earningsEmoji}>🎉</Text>
        <Text style={styles.earningsLabel}>{t('captain.earned')}</Text>
        <Text style={styles.earningsValue}>{formatFare(REQUEST_FARE)}</Text>
        <View style={styles.earningsPill}>
          <Text style={styles.earningsPillText}>Ride completed ✓</Text>
        </View>
      </Animated.View>

      <PrimaryButton label={t('captain.returnHome')} onPress={onHome} />
    </ScreenShell>
  );
}

/* ─────────────────────────── HELPERS ─────────────────────────── */

function Detail({
  label,
  value,
  icon,
  hideIcon,
  last,
}: {
  label: string;
  value: string;
  icon: string;
  hideIcon?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.detail, !last && styles.detailDivider]}>
      {!hideIcon && <Text style={styles.detailIcon}>{icon}</Text>}
      <View style={styles.detailText}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────── STYLES ─────────────────────────── */

const styles = StyleSheet.create({
  // Login
  loginHero: {
    alignItems: 'center',
    backgroundColor: colors.bgAlt,
    borderRadius: radii.xl,
    gap: 10,
    paddingVertical: 24,
  },
  loginEmoji: { fontSize: 42 },
  loginTitle: {
    color: colors.primaryDark,
    fontFamily,
    fontSize: fontSize.md,
    lineHeight: 26,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  inputCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    gap: 8,
    padding: 16,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  input: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: 4,
    minHeight: 48,
  },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  key: {
    alignItems: 'center',
    backgroundColor: colors.keyBg,
    borderColor: colors.keyBorder,
    borderRadius: radii.md,
    borderWidth: 1.5,
    height: 62,
    justifyContent: 'center',
    width: '31%',
  },
  keyEmpty: { width: '31%' },
  keyText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '800' },
  deleteText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  error: { color: colors.error, fontFamily, fontSize: fontSize.sm, textAlign: 'center' },

  // Captain Home
  settingsBtn: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  settingsIcon: { fontSize: 16 },
  settingsText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },

  statusPanel: {
    alignItems: 'center',
    borderRadius: 28,
    gap: 10,
    minHeight: 280,
    justifyContent: 'center',
    padding: 28,
    overflow: 'hidden',
    position: 'relative',
  },
  statusOnline: { backgroundColor: colors.primary },
  statusOffline: { backgroundColor: '#6B7280' },

  pulseRing: {
    borderColor: '#FFFFFF',
    borderRadius: 80,
    borderWidth: 6,
    height: 160,
    position: 'absolute',
    width: 160,
  },
  statusDot: {
    color: '#FFFFFF',
    fontSize: 60,
    lineHeight: 68,
  },
  statusTitle: {
    color: '#FFFFFF',
    fontFamily,
    fontSize: fontSize['2xl'],
    fontWeight: '900',
    textAlign: 'center',
  },
  statusDetail: {
    color: 'rgba(255,255,255,0.80)',
    fontFamily,
    fontSize: fontSize.md,
    lineHeight: 26,
    textAlign: 'center',
  },
  statusChip: {
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderRadius: radii.pill,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  statusChipText: {
    color: '#FFFFFF',
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  waiting: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.md,
    lineHeight: 24,
    textAlign: 'center',
  },

  // Incoming request
  timerCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: 12,
    padding: 24,
    ...shadows.soft,
  },
  timerRingWrap: {
    alignItems: 'center',
    height: 110,
    justifyContent: 'center',
    width: 110,
  },
  timerRingBg: {
    borderColor: colors.border,
    borderRadius: 55,
    borderWidth: 8,
    height: 110,
    position: 'absolute',
    width: 110,
  },
  timerRingFill: {
    borderRadius: 55,
    borderWidth: 8,
    height: 110,
    position: 'absolute',
    width: 110,
  },
  timerNumber: {
    fontFamily,
    fontSize: 44,
    fontWeight: '900',
  },
  timerText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  instruction: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.md,
    lineHeight: 26,
    textAlign: 'center',
  },
  requestCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 4,
  },
  detail: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  detailDivider: { borderBottomColor: colors.divider, borderBottomWidth: 1 },
  detailIcon: { fontSize: 20, marginTop: 2 },
  detailText: { flex: 1, gap: 3 },
  detailLabel: {
    color: colors.textMuted,
    fontFamily,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  detailValue: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },

  // In progress
  inProgressBadge: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    gap: 8,
    paddingVertical: 20,
  },
  inProgressEmoji: { fontSize: 40 },
  inProgressLabel: {
    color: colors.primary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '900',
  },

  // Summary
  summarySubtitle: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.md,
    lineHeight: 26,
    textAlign: 'center',
  },
  earningsCard: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    gap: 8,
    padding: 36,
  },
  earningsEmoji: { fontSize: 44 },
  earningsLabel: {
    color: 'rgba(255,255,255,0.80)',
    fontFamily,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  earningsValue: {
    color: '#FFFFFF',
    fontFamily,
    fontSize: 56,
    fontWeight: '900',
  },
  earningsPill: {
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderRadius: radii.pill,
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  earningsPillText: {
    color: '#FFFFFF',
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
});
