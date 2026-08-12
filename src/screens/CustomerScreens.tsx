import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenShell } from '../components/ScreenShell';
import { formatFare, formatNumber, formatOtp } from '../utils/format';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';

export type RideKind = 'bike' | 'auto';
export type CustomerRide = { pickup: string; drop: string; kind: RideKind };
const NANDYAL: Region = { latitude: 15.4889, longitude: 78.4836, latitudeDelta: 0.035, longitudeDelta: 0.035 };

/* ─────────────────────────── LOGIN ─────────────────────────── */

export function CustomerLoginScreen({
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
  const del = () => (step === 'phone' ? setPhone(phone.slice(0, -1)) : setOtp(otp.slice(0, -1)));

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
    <ScreenShell back={onBack} title={step === 'phone' ? t('screens.customerLogin') : t('login.otpTitle')}>
      <View style={styles.loginHero}>
        <Text style={styles.loginEmoji}>📱</Text>
        <Text style={styles.loginTitle}>
          {step === 'phone' ? t('login.subtitle') : t('login.otpSubtitle')}
        </Text>
      </View>

      <View style={styles.inputCard}>
        <Text style={styles.inputLabel}>
          {step === 'phone' ? t('login.phoneLabel') : t('login.otpLabel')}
        </Text>
        <TextInput
          value={value}
          editable={false}
          keyboardType="number-pad"
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
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <View style={styles.pad}>
      {digits.map((d) => (
        <NumKey key={d} label={formatNumber(d)} onPress={() => onDigit(String(d))} />
      ))}
      <View style={styles.keyEmpty} />
      <NumKey label={formatNumber(0)} onPress={() => onDigit('0')} />
      <Pressable
        onPress={onDelete}
        style={styles.key}
        accessibilityRole="button"
        accessibilityLabel={t('actions.delete')}
      >
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
      accessibilityRole="button"
    >
      <Animated.View style={[styles.key, shadows.soft, { transform: [{ scale }] }]}>
        <Text style={styles.keyText}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

/* ─────────────────────────── HOME ─────────────────────────── */

export function CustomerHomeScreen({
  ride,
  onPickLocation,
  onChooseRide,
  onSettings,
  onBack,
}: {
  ride: CustomerRide;
  onPickLocation: (target: 'pickup' | 'drop') => void;
  onChooseRide: () => void;
  onSettings: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const ready = Boolean(ride.pickup && ride.drop);

  return (
    <ScreenShell back={onBack} title={t('screens.customerHome')}>
      {/* Settings button in header area */}
      <Pressable onPress={onSettings} style={styles.settingsBtn}>
        <Text style={styles.settingsIcon}>⚙️</Text>
        <Text style={styles.settingsText}>{t('actions.settings')}</Text>
      </Pressable>

      {/* Location card */}
      <View style={[styles.locationCard, shadows.card]}>
        <Text style={styles.locationCardLabel}>{t('home.locationHint')}</Text>
        <LocationRow
          icon="🟢"
          placeholder={t('home.pickup')}
          value={ride.pickup}
          onPress={() => onPickLocation('pickup')}
        />
        <View style={styles.locationDivider} />
        <LocationRow
          icon="🔴"
          placeholder={t('home.drop')}
          value={ride.drop}
          onPress={() => onPickLocation('drop')}
        />
      </View>

      <PrimaryButton
        label={t('home.chooseRide')}
        onPress={onChooseRide}
        disabled={!ready}
      />
    </ScreenShell>
  );
}

function LocationRow({
  icon,
  placeholder,
  value,
  onPress,
}: {
  icon: string;
  placeholder: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.locationRow}>
      <Text style={styles.locationIcon}>{icon}</Text>
      <Text style={[styles.locationText, !value && styles.locationPlaceholder]} numberOfLines={1}>
        {value || placeholder}
      </Text>
      <Text style={styles.locationEdit}>›</Text>
    </Pressable>
  );
}

/* ─────────────────────────── LOCATION PICKER ─────────────────────────── */

export function LocationPickerScreen({
  target,
  onSelect,
  onBack,
}: {
  target: 'pickup' | 'drop';
  onSelect: (place: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState({ latitude: NANDYAL.latitude, longitude: NANDYAL.longitude });
  const [focused, setFocused] = useState(false);

  const localResults = useMemo(
    () => [t('location.busStand'), t('location.railway'), t('location.medical')],
    [t],
  );

  useEffect(() => {
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey || query.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(() => {
      fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&components=country:in&key=${apiKey}`,
      )
        .then((r) => r.json())
        .then((data) =>
          setResults(
            (data.predictions ?? []).slice(0, 5).map((item: { description: string }) => item.description),
          ),
        )
        .catch(() => setResults([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const useGps = async () => {
    setGpsLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status === 'granted') {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        onSelect(
          `${t('location.gpsDefault')} (${formatNumber(current.coords.latitude, { maximumFractionDigits: 4 })}, ${formatNumber(current.coords.longitude, { maximumFractionDigits: 4 })})`,
        );
        return;
      }
    } finally {
      setGpsLoading(false);
    }
    onSelect(t('location.gpsDefault'));
  };

  const shown = results.length
    ? results
    : localResults.filter((item) => item.toLowerCase().includes(query.toLowerCase()));

  return (
    <ScreenShell
      back={onBack}
      title={t(target === 'pickup' ? 'location.pickupTitle' : 'location.dropTitle')}
    >
      {!pinMode ? (
        <>
          {/* Search bar */}
          <View style={[styles.searchBar, focused && styles.searchBarFocused, shadows.soft]}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('location.searchPlaceholder')}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
          </View>

          <PrimaryButton
            label={gpsLoading ? t('location.gpsLoading') : t('location.gps')}
            onPress={useGps}
            secondary
            small
          />

          {/* Nearby results */}
          <Text style={styles.sectionLabel}>{t('location.nearby')}</Text>
          <View style={[styles.resultsCard, shadows.soft]}>
            {shown.map((place, i) => (
              <Pressable
                key={place}
                onPress={() => onSelect(place)}
                style={[styles.resultRow, i < shown.length - 1 && styles.resultRowDivider]}
              >
                <Text style={styles.resultPin}>📍</Text>
                <Text style={styles.resultText} numberOfLines={2}>{place}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.hint}>{t('location.placesUnavailable')}</Text>
          <Text style={styles.sectionLabel}>{t('location.pinPrompt')}</Text>
          <PrimaryButton label={t('location.dropPin')} onPress={() => setPinMode(true)} secondary small />
        </>
      ) : (
        <>
          <Text style={styles.sectionLabel}>{t('location.mapTitle')}</Text>
          <Text style={styles.hint}>{t('location.mapHint', { target: t(`location.${target}`) })}</Text>
          <View style={[styles.mapWrap, shadows.card]}>
            <MapView
              provider={PROVIDER_GOOGLE}
              initialRegion={NANDYAL}
              onPress={(event) => setPin(event.nativeEvent.coordinate)}
              style={styles.map}
            >
              <Marker coordinate={pin} />
            </MapView>
          </View>
          <PrimaryButton
            label={t('location.savePin')}
            onPress={() =>
              onSelect(
                `${t('location.dropPin')} (${formatNumber(pin.latitude, { maximumFractionDigits: 4 })}, ${formatNumber(pin.longitude, { maximumFractionDigits: 4 })})`,
              )
            }
          />
        </>
      )}
    </ScreenShell>
  );
}

/* ─────────────────────────── RIDE TYPE ─────────────────────────── */

export function RideTypeScreen({
  selected,
  onSelect,
  onNext,
  onBack,
}: {
  selected: RideKind;
  onSelect: (kind: RideKind) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const options: Array<{ kind: RideKind; icon: string; color: string; fare: number; eta: number }> = [
    { kind: 'bike', icon: '🏍️', color: '#FEF3C7', fare: 55, eta: 3 },
    { kind: 'auto', icon: '🛺', color: colors.primaryLight, fare: 75, eta: 5 },
  ];

  return (
    <ScreenShell back={onBack} title={t('screens.rideType')}>
      {options.map((option) => (
        <RideCard
          key={option.kind}
          option={option}
          selected={selected === option.kind}
          onSelect={() => onSelect(option.kind)}
          t={t}
        />
      ))}
      <PrimaryButton label={t('actions.continue')} onPress={onNext} />
    </ScreenShell>
  );
}

function RideCard({
  option,
  selected,
  onSelect,
  t,
}: {
  option: { kind: RideKind; icon: string; color: string; fare: number; eta: number };
  selected: boolean;
  onSelect: () => void;
  t: (k: string) => string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={onSelect}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()
      }
    >
      <Animated.View
        style={[
          styles.rideCard,
          selected && styles.rideCardSelected,
          shadows.card,
          { transform: [{ scale }] },
        ]}
      >
        <View style={[styles.rideIconBadge, { backgroundColor: option.color }]}>
          <Text style={styles.rideIcon}>{option.icon}</Text>
        </View>
        <View style={styles.rideTextWrap}>
          <Text style={styles.rideName}>{t(`rides.${option.kind}`)}</Text>
          <Text style={styles.rideDetail}>{t(`rides.${option.kind}Detail`)}</Text>
          <View style={styles.rideChips}>
            <Chip label={(t as any)('rides.fare', { fare: formatFare(option.fare) })} />
            <Chip label={(t as any)('rides.eta', { minutes: formatNumber(option.eta) })} />
          </View>
        </View>
        {selected && (
          <View style={styles.rideCheck}>
            <Text style={styles.rideCheckText}>✓</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

/* ─────────────────────────── BOOKING CONFIRM ─────────────────────────── */

export function BookingConfirmScreen({
  ride,
  onBook,
  onBack,
}: {
  ride: CustomerRide;
  onBook: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const fare = ride.kind === 'bike' ? 55 : 75;
  return (
    <ScreenShell back={onBack} title={t('screens.bookingConfirm')}>
      <View style={[styles.summaryCard, shadows.card]}>
        <SummaryRow label={t('rides.pickup')} value={ride.pickup} icon="🟢" />
        <SummaryRow label={t('rides.drop')} value={ride.drop} icon="🔴" />
        <SummaryRow label={t('rides.ride')} value={t(`rides.${ride.kind}`)} icon={ride.kind === 'bike' ? '🏍️' : '🛺'} />
        <SummaryRow label={t('rides.estimate')} value={formatFare(fare)} icon="💰" last />
      </View>
      <PrimaryButton label={t('rides.book')} onPress={onBook} />
    </ScreenShell>
  );
}

function SummaryRow({
  label,
  value,
  icon,
  last,
}: {
  label: string;
  value: string;
  icon: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.summaryRow, !last && styles.summaryRowDivider]}>
      <Text style={styles.summaryIcon}>{icon}</Text>
      <View style={styles.summaryText}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────── SEARCHING ─────────────────────────── */

export function SearchingScreen({ onFound, onBack }: { onFound: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();
    const id = setTimeout(onFound, 3500);
    return () => clearTimeout(id);
  }, [onFound, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <ScreenShell back={onBack} title={t('rides.searchingTitle')}>
      <View style={styles.searchingCenter}>
        <View style={styles.searchingRingWrap}>
          <Animated.View style={[styles.searchingRing, { transform: [{ rotate }] }]} />
          <Text style={styles.searchingEmoji}>🛺</Text>
        </View>
        <Text style={styles.searchingTitle}>{t('rides.searchingTitle')}</Text>
        <Text style={styles.searchingSubtitle}>{t('rides.searchingSubtitle')}</Text>
      </View>
    </ScreenShell>
  );
}

/* ─────────────────────────── RIDE CONFIRMED ─────────────────────────── */

export function RideConfirmedScreen({ onHome }: { onHome: () => void }) {
  const { t } = useTranslation();
  const cancel = () =>
    Alert.alert(
      t('rides.cancelTitle'),
      t('rides.cancelMessage'),
      [
        { text: t('rides.keepRide'), style: 'cancel' },
        { text: t('rides.confirmCancel'), style: 'destructive', onPress: onHome },
      ],
    );

  return (
    <ScreenShell back={onHome} title={t('rides.confirmedTitle')}>
      {/* Captain card */}
      <View style={[styles.captainCard, shadows.card]}>
        <View style={styles.captainAvatar}>
          <Text style={styles.captainAvatarEmoji}>👤</Text>
        </View>
        <Text style={styles.captainName}>{t('mock.captainName')}</Text>
        <View style={styles.captainDetails}>
          <SummaryRow
            label={t('rides.vehicle')}
            value={t('mock.vehicle', { district: formatNumber(21), number: formatOtp(1234) })}
            icon="🚗"
          />
          <SummaryRow
            label={t('rides.arriving')}
            value={t('rides.eta', { minutes: formatNumber(4) })}
            icon="⏱️"
            last
          />
        </View>
      </View>

      <PrimaryButton label={t('rides.cancelRide')} onPress={cancel} danger />
      <PrimaryButton label={t('rides.backHome')} onPress={onHome} />
    </ScreenShell>
  );
}

/* ─────────────────────────── STYLES ─────────────────────────── */

const styles = StyleSheet.create({
  // Login
  loginHero: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
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
    ...shadows.soft,
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

  // Number pad
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
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
  keyText: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  deleteText: {
    color: colors.primary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  error: {
    color: colors.error,
    fontFamily,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },

  // Home
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
  settingsText: {
    color: colors.primary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  locationCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  locationCardLabel: {
    color: colors.textMuted,
    fontFamily,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: 16,
    paddingTop: 14,
    textTransform: 'uppercase',
  },
  locationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  locationIcon: { fontSize: 18 },
  locationText: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  locationPlaceholder: { color: colors.textMuted, fontWeight: '400' },
  locationEdit: {
    color: colors.textMuted,
    fontSize: 22,
  },
  locationDivider: {
    backgroundColor: colors.divider,
    height: 1,
    marginHorizontal: 16,
  },
  hint: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    lineHeight: 22,
    textAlign: 'center',
  },

  // Location picker
  searchBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  searchBarFocused: { borderColor: colors.primary },
  searchIcon: { fontSize: 18 },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily,
    fontSize: fontSize.md,
    minHeight: 48,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  resultsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  resultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resultRowDivider: { borderBottomColor: colors.divider, borderBottomWidth: 1 },
  resultPin: { fontSize: 18 },
  resultText: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily,
    fontSize: fontSize.md,
  },
  mapWrap: { borderRadius: radii.lg, height: 310, overflow: 'hidden' },
  map: { flex: 1 },

  // Ride type
  rideCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 14,
    padding: 18,
  },
  rideCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  rideIconBadge: {
    alignItems: 'center',
    borderRadius: radii.lg,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  rideIcon: { fontSize: 36 },
  rideTextWrap: { flex: 1, gap: 4 },
  rideName: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  rideDetail: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
  },
  rideChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    backgroundColor: colors.bgAlt,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    fontWeight: '700',
  },
  rideCheck: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  rideCheckText: { color: '#fff', fontSize: 14, fontWeight: '900' },

  // Booking confirm
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 4,
  },
  summaryRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  summaryRowDivider: { borderBottomColor: colors.divider, borderBottomWidth: 1 },
  summaryIcon: { fontSize: 20, marginTop: 2 },
  summaryText: { flex: 1, gap: 3 },
  summaryLabel: {
    color: colors.textMuted,
    fontFamily,
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },

  // Searching
  searchingCenter: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 48,
    gap: 18,
  },
  searchingRingWrap: {
    alignItems: 'center',
    height: 120,
    justifyContent: 'center',
    width: 120,
  },
  searchingRing: {
    borderColor: colors.primary,
    borderRadius: 60,
    borderWidth: 4,
    borderTopColor: 'transparent',
    height: 120,
    position: 'absolute',
    width: 120,
  },
  searchingEmoji: { fontSize: 52 },
  searchingTitle: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize['2xl'],
    fontWeight: '900',
    textAlign: 'center',
  },
  searchingSubtitle: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.md,
    lineHeight: 26,
    textAlign: 'center',
  },

  // Ride confirmed
  captainCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: 24,
    gap: 12,
  },
  captainAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: 50,
    height: 88,
    justifyContent: 'center',
    width: 88,
  },
  captainAvatarEmoji: { fontSize: 44 },
  captainName: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.xl,
    fontWeight: '900',
  },
  captainDetails: {
    alignSelf: 'stretch',
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    marginTop: 4,
    overflow: 'hidden',
  },
});
