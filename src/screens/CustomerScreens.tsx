import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  LayoutAnimation,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { clamp, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenShell } from '../components/ScreenShell';
import { PhoneOtpAuth } from '../components/PhoneOtpAuth';
import { customerAuthService } from '../services/customerAuth';
import { rideCreationService, type CancellationReason } from '../services/rideCreation';
import { rideDispatchService, type DispatchRide, type RideStatus } from '../services/rideDispatch';
import { LiveLocationMap } from '../components/LiveLocationMap';
import { CustomerRideSettlement } from './CustomerRideSettlement';
import { formatFare, formatNumber, formatOtp } from '../utils/format';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';

export type RideKind = 'bike' | 'auto';
export type Coordinate = { latitude: number; longitude: number };
export type CustomerRide = { id?: string; pickup: string; drop: string; kind: RideKind; pickupCoordinate?: Coordinate; dropCoordinate?: Coordinate };
type LocationTarget = 'pickup' | 'drop';
const NANDYAL: Region = { latitude: 15.4889, longitude: 78.4836, latitudeDelta: 0.035, longitudeDelta: 0.035 };
const estimateCoordinateDistanceKm = (a: Coordinate, b: Coordinate) => Math.sqrt((a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2) * 111;

/* ─────────────────────────── LOGIN ─────────────────────────── */

export function CustomerLoginScreen({
  onComplete,
  onBack,
}: {
  onComplete: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return <PhoneOtpAuth title={t('screens.customerLogin')} subtitle={t('login.subtitle')} emoji="📱" onBack={onBack} onSendOtp={customerAuthService.sendOtp} onVerifyOtp={async (phone, otp) => { await customerAuthService.verifyOtp(phone, otp); onComplete(); }} />;
}

/* ─────────────────────────── HOME ─────────────────────────── */

export function CustomerHomeScreen({
  ride,
  onPickLocation,
  onStartBooking,
  onProfile,
  onBack,
}: {
  ride: CustomerRide;
  onPickLocation: (target: LocationTarget) => void;
  onStartBooking: (pickup: string, coordinate: Coordinate) => void;
  onProfile: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const sheetHeight = Math.min(520, Dimensions.get('window').height * 0.62);
  const collapsedOffset = Math.max(142, sheetHeight - 278);
  const sheetOffset = useSharedValue(collapsedOffset);
  const sheetDragStart = useSharedValue(collapsedOffset);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cachedAddress, setCachedAddress] = useState('');
  const [locationUnavailable, setLocationUnavailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let active = true;
    let subscription: Location.LocationSubscription | undefined;
    let firstFix = true;
    const updateCachedLocation = async (location: Location.LocationObject) => {
      const coordinate = { latitude: location.coords.latitude, longitude: location.coords.longitude };
      setUserLocation(coordinate);
      setLocationUnavailable(false);
      const address = await reverseGeocodeAddress(coordinate, t('location.gpsDefault'));
      if (active) setCachedAddress(address);
      if (firstFix) {
        firstFix = false;
        mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 500);
      }
    };
    const loadLocation = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active) return;
      if (permission.status !== 'granted') { setLocationUnavailable(true); return; }
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!active) return;
        await updateCachedLocation(current);
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 100, timeInterval: 30000 },
          (next) => { void updateCachedLocation(next); },
        );
      } catch { if (active) setLocationUnavailable(true); }
    };
    void loadLocation();
    return () => { active = false; subscription?.remove(); };
  }, []);

  const setSheet = (expanded: boolean) => {
    setSheetExpanded(expanded);
    sheetOffset.value = withSpring(expanded ? 0 : collapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
  };

  const sheetAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetOffset.value }] }));
  const sheetPanGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onBegin(() => { sheetDragStart.value = sheetOffset.value; })
    .onUpdate((event) => { sheetOffset.value = clamp(sheetDragStart.value + event.translationY, 0, collapsedOffset); })
    .onEnd((event) => {
      const expand = event.velocityY < -350 || (event.velocityY <= 350 && sheetOffset.value < collapsedOffset / 2);
      sheetOffset.value = withSpring(expand ? 0 : collapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
      runOnJS(setSheetExpanded)(expand);
    }), [collapsedOffset, sheetDragStart, sheetOffset]);

  const centerOnLocation = async () => {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      Alert.alert(t('home.locationServicesTitle'), t('home.locationServicesMessage'), [
        { text: t('actions.cancel'), style: 'cancel' },
        { text: t('home.openSettings'), onPress: () => { void Linking.openSettings(); } },
      ]);
      return;
    }
    // Recenter immediately to the latest foreground location. A subsequent
    // one-off reading quietly refines this point rather than making the tap
    // appear unresponsive while GPS acquires a new fix.
    if (userLocation) {
      mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 350);
    }
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') { setLocationUnavailable(true); return; }
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coordinate = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      setUserLocation(coordinate);
      setLocationUnavailable(false);
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.012, longitudeDelta: 0.012 }, userLocation ? 250 : 450);
      void reverseGeocodeAddress(coordinate, t('location.gpsDefault')).then(setCachedAddress);
    } catch {
      // Keep a useful fallback if the one-off high-accuracy request times out.
      if (userLocation) mapRef.current?.animateToRegion({ ...userLocation, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 650);
      else setLocationUnavailable(true);
    }
  };

  const landmarks = [
    { icon: '🚌', label: t('location.busStand'), target: 'drop' as const },
    { icon: '🚉', label: t('location.railway'), target: 'drop' as const },
    { icon: '✚', label: t('location.medical'), target: 'drop' as const },
    { icon: '🏛️', label: t('home.fort'), target: 'drop' as const },
  ];

  const startBooking = async () => {
    if (userLocation) { onStartBooking(cachedAddress || t('location.gpsDefault'), userLocation); return; }
    onPickLocation('pickup');
  };

  return (
    <SafeAreaView style={styles.mapHomeSafe} edges={['top', 'left', 'right']}>
      <LiveLocationMap mapRef={mapRef} location={userLocation} onMapReady={() => setMapReady(true)} />

      <View style={styles.mapHomeTopBar}>
        <View style={styles.mapHomeBrand}><Text style={styles.mapHomeBrandText}>{t('app.name')}</Text></View>
      </View>
      <Pressable onPress={centerOnLocation} accessibilityRole="button" accessibilityLabel={t('home.recenter')} style={[styles.recenterButton, shadows.card]}><Text style={styles.recenterIcon}>⌖</Text></Pressable>
      {!mapReady && <View style={styles.mapFallback}><Text style={styles.mapFallbackText}>{t('home.mapLoading')}</Text></View>}
      {locationUnavailable && <View style={styles.locationNotice}><Text style={styles.locationNoticeText}>{t('home.locationUnavailable')}</Text></View>}

      <GestureDetector gesture={sheetPanGesture}>
        <Reanimated.View style={[styles.homeSheet, { height: sheetHeight }, sheetAnimatedStyle, shadows.card]}>
          <Pressable onPress={() => setSheet(!sheetExpanded)} style={styles.sheetHandleArea} accessibilityRole="button" accessibilityLabel={t('home.toggleSheet')}>
            <View style={styles.sheetHandle} />
          </Pressable>
        <View style={styles.homeSheetContent}>
          <Pressable onPress={startBooking} accessibilityRole="button" style={styles.destinationAction}>
            <Text style={styles.destinationPin}>⌖</Text><View style={styles.destinationTextWrap}><Text style={styles.destinationLabel}>{t('home.whereTo')}</Text><Text style={styles.destinationSub}>{t('home.whereToHint')}</Text></View><Text style={styles.destinationArrow}>→</Text>
          </Pressable>
          <View style={styles.savedRow}>
            <SavedPlace icon="⌂" label={t('home.home')} sublabel={t('home.savedPlaceHint')} onPress={() => onPickLocation('pickup')} />
            <SavedPlace icon="▣" label={t('home.work')} sublabel={t('home.savedPlaceHint')} onPress={() => onPickLocation('pickup')} />
          </View>
          <View style={styles.homeExpandedOnly}>
            <View style={styles.sectionHeading}><Text style={styles.homeSectionTitle}>{t('home.nearby')}</Text><Text style={styles.homeSectionLink}>{t('home.seeAll')}</Text></View>
            <View style={styles.landmarkRow}>{landmarks.map((landmark) => <Pressable key={landmark.label} accessibilityRole="button" onPress={() => onPickLocation(landmark.target)} style={styles.landmarkCard}><Text style={styles.landmarkIcon}>{landmark.icon}</Text><Text style={styles.landmarkText} numberOfLines={2}>{landmark.label}</Text></Pressable>)}</View>
            <Pressable onPress={onProfile} accessibilityRole="button" style={styles.safetyCard}><Text style={styles.safetyIcon}>✓</Text><View style={styles.safetyTextWrap}><Text style={styles.safetyTitle}>{t('home.safetyTitle')}</Text><Text style={styles.safetySubtitle}>{t('home.safetySubtitle')}</Text></View><Text style={styles.safetyArrow}>›</Text></Pressable>
          </View>
        </View>
        </Reanimated.View>
      </GestureDetector>
      <View style={styles.homeTabBar}>
        <HomeTab icon="⌂" label={t('home.tabHome')} active />
        <HomeTab icon="▤" label={t('home.tabBookings')} onPress={() => Alert.alert(t('home.bookingsTitle'), t('home.bookingsMessage'))} />
        <HomeTab icon="?" label={t('home.tabHelp')} onPress={() => Alert.alert(t('home.helpTitle'), t('home.helpMessage'))} />
        <HomeTab icon="♙" label={t('home.tabProfile')} onPress={onProfile} />
      </View>
    </SafeAreaView>
  );
}

function SavedPlace({ icon, label, sublabel, onPress }: { icon: string; label: string; sublabel: string; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={styles.savedPlace}><Text style={styles.savedPlaceIcon}>{icon}</Text><View style={styles.savedPlaceText}><Text style={styles.savedPlaceLabel}>{label}</Text><Text style={styles.savedPlaceSub}>{sublabel}</Text></View></Pressable>;
}

function HomeTab({ icon, label, active, onPress }: { icon: string; label: string; active?: boolean; onPress?: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={styles.homeTab}><Text style={[styles.homeTabIcon, active && styles.homeTabIconActive]}>{icon}</Text><Text style={[styles.homeTabLabel, active && styles.homeTabLabelActive]} numberOfLines={1}>{label}</Text></Pressable>;
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
  ride,
  initialTarget,
  onChange,
  onContinue,
  onBack,
}: {
  ride: CustomerRide;
  initialTarget: LocationTarget;
  onChange: (target: LocationTarget, place: string, coordinate?: Coordinate) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState<Record<LocationTarget, string>>({ pickup: ride.pickup, drop: ride.drop });
  const [target, setTarget] = useState<LocationTarget>(initialTarget);
  const [results, setResults] = useState<string[]>([]);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState({ latitude: NANDYAL.latitude, longitude: NANDYAL.longitude });
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationUnavailable, setLocationUnavailable] = useState(false);
  const [focused, setFocused] = useState(false);
  const mapRef = useRef<MapView>(null);
  const hasCenteredOnUser = useRef(false);
  const pickupInput = useRef<TextInput>(null);
  const dropInput = useRef<TextInput>(null);
  const query = drafts[target];
  const ready = Boolean(ride.pickup && ride.drop);

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

  const setDraft = (nextTarget: LocationTarget, value: string) => {
    setTarget(nextTarget);
    setDrafts((current) => ({ ...current, [nextTarget]: value }));
  };

  const choosePlace = async (place: string, suppliedCoordinate?: Coordinate) => {
    const coordinate = suppliedCoordinate ?? await geocodeAddress(place);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDrafts((current) => ({ ...current, [target]: place }));
    onChange(target, place, coordinate);
    if (target === 'pickup') {
      setTarget('drop');
      requestAnimationFrame(() => dropInput.current?.focus());
    }
  };

  const updateUserLocation = (location: Location.LocationObject) => {
    const coordinate = { latitude: location.coords.latitude, longitude: location.coords.longitude };
    setUserLocation(coordinate);
    setLocationUnavailable(false);
    if (!hasCenteredOnUser.current) {
      hasCenteredOnUser.current = true;
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 500);
    }
    return coordinate;
  };

  useEffect(() => {
    if (!pinMode) return;
    let subscription: Location.LocationSubscription | undefined;
    let active = true;
    hasCenteredOnUser.current = false;

    const beginLiveLocation = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active) return;
      if (permission.status !== 'granted') { setLocationUnavailable(true); return; }
      try {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (active) updateUserLocation(current);
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 5, timeInterval: 5000 },
          (next) => { if (active) updateUserLocation(next); },
        );
      } catch {
        if (active) setLocationUnavailable(true);
      }
    };
    void beginLiveLocation();
    return () => { active = false; subscription?.remove(); };
  }, [pinMode]);

  const centerOnLiveLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') { setLocationUnavailable(true); return; }
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      hasCenteredOnUser.current = false;
      updateUserLocation(current);
    } catch { setLocationUnavailable(true); }
  };

  const useGps = async () => {
    setGpsLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status === 'granted') {
        const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const coordinate = { latitude: current.coords.latitude, longitude: current.coords.longitude };
        choosePlace(await reverseGeocodeAddress(coordinate, t('location.gpsDefault')), coordinate);
        return;
      }
    } finally {
      setGpsLoading(false);
    }
    choosePlace(t('location.gpsDefault'));
  };

  const shown = results.length ? results : localResults.filter((item) => item.toLowerCase().includes(query.toLowerCase()));
  const showNoMatches = query.trim().length >= 2 && shown.length === 0;

  if (pinMode) {
    return <PinDropPicker
      target={target}
      initialCoordinate={target === 'pickup' ? ride.pickupCoordinate : ride.dropCoordinate}
      onBack={() => setPinMode(false)}
      onConfirm={(address, coordinate) => { void choosePlace(address, coordinate); setPinMode(false); }}
    />;
  }

  return (
    <ScreenShell
      back={onBack}
      title={t('location.rideLocationsTitle')}
    >
      <>
          <Text style={styles.locationFormIntro}>{t('location.rideLocationsHint')}</Text>
          <View style={[styles.locationFormCard, shadows.card]}>
            <LocationField
              inputRef={pickupInput}
              active={target === 'pickup'}
              icon="●"
              label={t('location.pickupField')}
              value={drafts.pickup}
              placeholder={t('home.pickup')}
              onFocus={() => { setTarget('pickup'); setFocused(true); }}
              onBlur={() => setFocused(false)}
              onChangeText={(value) => setDraft('pickup', value)}
            />
            <View style={styles.locationFieldDivider} />
            <LocationField
              inputRef={dropInput}
              active={target === 'drop'}
              icon="●"
              label={t('location.destinationField')}
              value={drafts.drop}
              placeholder={t('home.drop')}
              onFocus={() => { setTarget('drop'); setFocused(true); }}
              onBlur={() => setFocused(false)}
              onChangeText={(value) => setDraft('drop', value)}
              drop
            />
          </View>
          <PrimaryButton
            label={gpsLoading ? t('location.gpsLoading') : t('location.gps')}
            onPress={useGps}
            secondary
            small
          />
          <Text style={styles.sectionLabel}>{query.trim().length ? t('location.addressMatches') : t('location.nearby')}</Text>
          {shown.length > 0 && <View style={[styles.resultsCard, shadows.soft]}>{shown.map((place, i) => (
            <Pressable key={place} onPress={() => choosePlace(place)} style={[styles.resultRow, i < shown.length - 1 && styles.resultRowDivider]}>
              <Text style={styles.resultPin}>📍</Text><Text style={styles.resultText} numberOfLines={2}>{place}</Text>
            </Pressable>
          ))}</View>}
          {!query.trim() && <Text style={styles.hint}>{t('location.placesUnavailable')}</Text>}
          {showNoMatches && <View style={styles.pinFallback}><Text style={styles.pinFallbackTitle}>{t('location.pinPrompt')}</Text><Text style={styles.pinFallbackHint}>{t('location.pinFallbackHint')}</Text><PrimaryButton label={t('location.dropPin')} onPress={() => setPinMode(true)} secondary small /></View>}
          {ready && <PrimaryButton label={t('location.showRideOptions')} onPress={onContinue} />}
      </>
    </ScreenShell>
  );
}

function LocationField({ inputRef, active, icon, label, value, placeholder, onFocus, onBlur, onChangeText, drop }: {
  inputRef: React.RefObject<TextInput | null>; active: boolean; icon: string; label: string; value: string; placeholder: string; onFocus: () => void; onBlur: () => void; onChangeText: (value: string) => void; drop?: boolean;
}) {
  return <View style={[styles.locationField, active && styles.locationFieldActive]}><View style={[styles.locationFieldDot, drop && styles.locationFieldDotDrop]}><Text style={[styles.locationFieldDotText, drop && styles.locationFieldDotTextDrop]}>{icon}</Text></View><View style={styles.locationFieldTextWrap}><Text style={styles.locationFieldLabel}>{label}</Text><TextInput ref={inputRef} value={value} onFocus={onFocus} onBlur={onBlur} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.textMuted} style={styles.locationFieldInput} returnKeyType="next" /></View></View>;
}

function PinDropPicker({ target, initialCoordinate, onBack, onConfirm }: { target: LocationTarget; initialCoordinate?: Coordinate; onBack: () => void; onConfirm: (address: string, coordinate: Coordinate) => void }) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coordinate = initialCoordinate ?? { latitude: NANDYAL.latitude, longitude: NANDYAL.longitude };
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate>(coordinate);
  const [address, setAddress] = useState(t('location.resolvingAddress'));

  const resolveAddress = (next: Coordinate) => {
    if (timer.current) clearTimeout(timer.current);
    setAddress(t('location.resolvingAddress'));
    timer.current = setTimeout(() => {
      reverseGeocodeAddress(next, t('location.pinAddressFallback')).then(setAddress);
    }, 350);
  };

  useEffect(() => {
    resolveAddress(coordinate);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  return <SafeAreaView style={styles.pinPickerSafe} edges={['top', 'left', 'right']}>
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      initialRegion={{ ...coordinate, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
      onRegionChangeComplete={(region) => {
        const next = { latitude: region.latitude, longitude: region.longitude };
        setSelectedCoordinate(next);
        resolveAddress(next);
      }}
      style={StyleSheet.absoluteFill}
    />
    <View pointerEvents="none" style={styles.fixedPinWrap}><View style={styles.fixedPin}><Text style={styles.fixedPinText}>●</Text></View><View style={styles.fixedPinStem} /></View>
    <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={onBack} style={[styles.pinPickerBack, shadows.card]}><Text style={styles.pinPickerBackText}>‹</Text></Pressable>
    <View style={[styles.pinPickerSheet, shadows.card]}>
      <View style={styles.sheetHandle} />
      <Text style={styles.pinPickerTitle}>{t(target === 'pickup' ? 'location.selectPickup' : 'location.selectDrop')}</Text>
      <View style={styles.pinAddressCard}><Text style={styles.pinAddressIcon}>●</Text><Text style={styles.pinAddressText} numberOfLines={3}>{address}</Text></View>
      <PrimaryButton label={t(target === 'pickup' ? 'location.confirmPickup' : 'location.confirmDrop')} onPress={() => onConfirm(address, selectedCoordinate)} />
    </View>
  </SafeAreaView>;
}

async function reverseGeocodeAddress(coordinate: Coordinate, fallback: string) {
  try {
    const [place] = await Location.reverseGeocodeAsync(coordinate);
    if (!place) return fallback;
    const lineOne = [place.name, place.street, place.streetNumber].filter(Boolean).join(', ');
    const lineTwo = [place.district, place.city, place.region].filter(Boolean).join(', ');
    return [lineOne, lineTwo].filter(Boolean).join(', ') || fallback;
  } catch { return fallback; }
}

async function geocodeAddress(address: string): Promise<Coordinate | undefined> {
  try {
    const [place] = await Location.geocodeAsync(address);
    return place ? { latitude: place.latitude, longitude: place.longitude } : undefined;
  } catch { return undefined; }
}

/* ─────────────────────────── RIDE TYPE ─────────────────────────── */

export function RideTypeScreen({
  ride,
  selected,
  onSelect,
  onNext,
  onBack,
}: {
  ride: CustomerRide;
  selected: RideKind;
  onSelect: (kind: RideKind) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const pickupCoordinate = ride.pickupCoordinate ?? locationCoordinate(ride.pickup, 0);
  const dropCoordinate = ride.dropCoordinate ?? locationCoordinate(ride.drop, 1);
  const routeCoordinates = [
    pickupCoordinate,
    { latitude: (pickupCoordinate.latitude + dropCoordinate.latitude) / 2 + 0.0014, longitude: (pickupCoordinate.longitude + dropCoordinate.longitude) / 2 - 0.0012 },
    dropCoordinate,
  ];

  useEffect(() => {
    const timer = setTimeout(() => mapRef.current?.fitToCoordinates(routeCoordinates, { animated: true, edgePadding: { top: 34, right: 34, bottom: 34, left: 34 } }), 100);
    return () => clearTimeout(timer);
  }, [ride.drop, ride.pickup]);
  const options: Array<{ kind: RideKind; icon: string; fare: number; eta: number }> = [
    { kind: 'bike', icon: '🏍️', fare: 55, eta: 3 },
    { kind: 'auto', icon: '🛺', fare: 75, eta: 5 },
  ];

  return <SafeAreaView style={styles.rideOptionsSafe} edges={['top', 'left', 'right']}>
    <MapView ref={mapRef} provider={PROVIDER_GOOGLE} initialRegion={NANDYAL} style={StyleSheet.absoluteFill}>
          <Marker coordinate={pickupCoordinate} pinColor={colors.success} title={t('rides.pickup')} />
          <Marker coordinate={dropCoordinate} pinColor={colors.accent} title={t('rides.drop')} />
          <Polyline coordinates={routeCoordinates} strokeColor={colors.primaryDark} strokeWidth={5} />
          <Marker coordinate={{ latitude: routeCoordinates[1].latitude + 0.001, longitude: routeCoordinates[1].longitude - 0.001 }}><View style={styles.captainMarker}><Text style={styles.captainMarkerText}>🛺</Text></View></Marker>
          <Marker coordinate={{ latitude: routeCoordinates[1].latitude - 0.0012, longitude: routeCoordinates[1].longitude + 0.001 }}><View style={styles.captainMarker}><Text style={styles.captainMarkerText}>🏍️</Text></View></Marker>
    </MapView>
    <View style={[styles.rideOptionsTop, { paddingTop: Math.max(insets.top + 8, 20) }]}>
      <Pressable onPress={onBack} accessibilityRole="button" style={[styles.rideOptionsBack, shadows.soft]}><Text style={styles.rideOptionsBackText}>‹</Text></Pressable>
      <View style={[styles.routeSummary, shadows.soft]}><Text style={styles.routeSummaryDot}>●</Text><Text style={styles.routeSummaryText} numberOfLines={1}>{ride.pickup}</Text><Text style={styles.routeSummaryArrow}>→</Text><Text style={styles.routeSummaryText} numberOfLines={1}>{ride.drop}</Text></View>
    </View>
    <View style={[styles.rideOptionsSheet, shadows.card]}>
      <View style={styles.sheetHandle} />
      <Text style={styles.rideOptionsHeading}>{t('rides.selectRide')}</Text>
      <View style={styles.rideOptionList}>{options.map((option) => (
        <RideCard
          key={option.kind}
          option={option}
          selected={selected === option.kind}
          onSelect={() => onSelect(option.kind)}
          t={t}
        />
      ))}</View>
      <View style={styles.rideOptionsExtras}><Text style={styles.rideOptionsExtra}>₹ {t('rides.cash')}</Text><View style={styles.rideOptionsDivider} /><Text style={styles.rideOptionsExtra}>{t('rides.offers')}</Text></View>
      <PrimaryButton label={t('rides.bookSelected', { ride: t(`rides.${selected}`) })} onPress={onNext} />
    </View>
  </SafeAreaView>;
}

function locationCoordinate(place: string, offset: number) {
  const checksum = Array.from(place).reduce((total, character) => total + character.charCodeAt(0), 0);
  return {
    latitude: NANDYAL.latitude + (((checksum % 9) - 4) * 0.0021) + (offset * 0.001),
    longitude: NANDYAL.longitude + ((((checksum >> 3) % 9) - 4) * 0.0021) - (offset * 0.001),
  };
}

function RideCard({
  option,
  selected,
  onSelect,
  t,
}: {
  option: { kind: RideKind; icon: string; fare: number; eta: number };
  selected: boolean;
  onSelect: () => void;
  t: (k: string) => string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const selectedValue = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(selectedValue, { toValue: selected ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [selected, selectedValue]);
  const selectedBorder = selectedValue.interpolate({ inputRange: [0, 1], outputRange: ['transparent', colors.primary] });
  const selectedBackground = selectedValue.interpolate({ inputRange: [0, 1], outputRange: ['rgba(224,247,243,0)', colors.primaryLight] });
  return (
    <Pressable
      onPress={onSelect}
      onPressIn={() =>
        Animated.spring(scale, { toValue: 0.97, useNativeDriver: false, speed: 50 }).start()
      }
      onPressOut={() =>
        Animated.spring(scale, { toValue: 1, useNativeDriver: false, speed: 50 }).start()
      }
    >
      <Animated.View
        style={[
          styles.rideCard,
          { backgroundColor: selectedBackground, borderColor: selectedBorder },
          { transform: [{ scale }] },
        ]}
      >
        <View style={styles.rideIconBadge}>
          <Text style={styles.rideIcon}>{option.icon}</Text>
        </View>
        <View style={styles.rideTextWrap}>
          <Text style={styles.rideName}>{t(`rides.${option.kind}`)}</Text>
          <Text style={styles.rideDetail}>{t(`rides.${option.kind}Detail`)} · {(t as any)('rides.eta', { minutes: formatNumber(option.eta) })}</Text>
        </View>
        <Text style={styles.rideFare}>{formatFare(option.fare)}</Text>
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
  onBook: (rideId: string) => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const fare = ride.kind === 'bike' ? 55 : 75;
  const [booking, setBooking] = useState(false);
  const book = async () => {
    setBooking(true);
    try {
      const createdRide = await rideCreationService.create(ride);
      await onBook(createdRide.id);
    } catch {
      Alert.alert(t('login.tryAgain'));
    } finally {
      setBooking(false);
    }
  };
  return (
    <ScreenShell back={onBack} title={t('screens.bookingConfirm')}>
      <View style={[styles.summaryCard, shadows.card]}>
        <SummaryRow label={t('rides.pickup')} value={ride.pickup} icon="🟢" />
        <SummaryRow label={t('rides.drop')} value={ride.drop} icon="🔴" />
        <SummaryRow label={t('rides.ride')} value={t(`rides.${ride.kind}`)} icon={ride.kind === 'bike' ? '🏍️' : '🛺'} />
        <SummaryRow label={t('rides.estimate')} value={formatFare(fare)} icon="💰" last />
      </View>
      <PrimaryButton label={booking ? t('login.pleaseWait') : t('rides.book')} onPress={() => { void book(); }} disabled={booking} />
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

export function SearchingScreen({ rideId, onFound, onBack, onUnavailable }: { rideId?: string; onFound: () => void; onBack: () => void; onUnavailable?: () => void }) {
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
    if (!rideId || rideId.startsWith('local-')) {
      const id = setTimeout(onFound, 3500);
      return () => clearTimeout(id);
    }
    return rideDispatchService.subscribeToRide(rideId, (ride) => {
      if (ride.status === 'accepted' || ride.status === 'arrived' || ride.status === 'in_progress' || ride.status === 'completed') onFound();
      if (ride.status === 'cancelled') onUnavailable?.();
    });
  }, [onFound, rideId, spin]);

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

const cancellationReasons: Array<{ code: CancellationReason; labelKey: string }> = [
  { code: 'change_plans', labelKey: 'ChangePlans' },
  { code: 'another_ride', labelKey: 'AnotherRide' },
  { code: 'wait_time', labelKey: 'WaitTime' },
  { code: 'fare_concern', labelKey: 'Fare' },
  { code: 'captain_unreachable', labelKey: 'Captain' },
  { code: 'other', labelKey: 'Other' },
];

export function RideConfirmedScreen({ ride, onHome }: { ride: CustomerRide; onHome: () => void }) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const [step, setStep] = useState(0);
  const [cancelStep, setCancelStep] = useState<'none' | 'confirm' | 'reason'>('none');
  const [cancellationReason, setCancellationReason] = useState<CancellationReason | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [cancellationError, setCancellationError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [liveStatus, setLiveStatus] = useState<RideStatus>('accepted');
  const [liveRide, setLiveRide] = useState<DispatchRide | null>(null);
  const [captainDetails, setCaptainDetails] = useState<{ fullName: string; vehicleType: RideKind | null } | null>(null);
  const [pickupPin, setPickupPin] = useState<string | null>(null);
  const pickup = ride.pickupCoordinate ?? locationCoordinate(ride.pickup, 0);
  const captainStart = { latitude: pickup.latitude - 0.008, longitude: pickup.longitude - 0.006 };
  const captainCoordinate = {
    latitude: captainStart.latitude + ((pickup.latitude - captainStart.latitude) * step / 8),
    longitude: captainStart.longitude + ((pickup.longitude - captainStart.longitude) * step / 8),
  };
  const approachRoute = [captainStart, { latitude: captainStart.latitude + 0.003, longitude: captainStart.longitude + 0.002 }, pickup];
  const etaMinutes = Math.max(1, 4 - Math.floor(step / 2));
  const captainDistanceKm = Math.max(0.2, 1.8 - (step * 0.2));
  const arrived = liveStatus === 'arrived' || liveStatus === 'in_progress' || liveStatus === 'completed';
  const canCancel = liveStatus === 'requested' || liveStatus === 'searching' || liveStatus === 'accepted' || liveStatus === 'in_progress';
  const captainName = captainDetails?.fullName || t('rides.captain');
  const vehicleType = captainDetails?.vehicleType;

  useEffect(() => {
    mapRef.current?.fitToCoordinates([captainStart, pickup], { animated: true, edgePadding: { top: 120, right: 50, bottom: 300, left: 50 } });
    const id = setInterval(() => setStep((current) => Math.min(current + 1, 8)), 3000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (!ride.id || ride.id.startsWith('local-')) return;
    return rideDispatchService.subscribeToRide(ride.id, (updatedRide) => {
      setLiveStatus(updatedRide.status);
      setLiveRide(updatedRide);
      if (updatedRide.captain_id) {
        void rideDispatchService.getAssignedCaptain(updatedRide.id).then(setCaptainDetails).catch(() => setCaptainDetails(null));
      }
      if (updatedRide.status === 'accepted' || updatedRide.status === 'arrived') {
        void rideDispatchService.getCustomerPickupPin(updatedRide.id).then(setPickupPin).catch(() => setPickupPin(null));
      }
    });
  }, [onHome, ride.id]);
  const startCancellation = () => {
    setCancellationReason(null);
    setOtherReason('');
    setCancellationError('');
    setCancelStep('confirm');
  };
  const submitCancellation = async () => {
    if (!cancellationReason) return setCancellationError(t('rides.cancelReasonRequired'));
    if (cancellationReason === 'other' && !otherReason.trim()) return setCancellationError(t('rides.cancelReasonOtherRequired'));
    if (!ride.id) return setCancellationError(t('login.tryAgain'));
    setCancelling(true);
    try {
      const result = await rideCreationService.cancel(ride.id, cancellationReason, otherReason);
      Alert.alert(t('rides.rideCancelled'), t('rides.cancellationCharge', { charge: formatFare(result.cancellationCharge ?? 0) }), [{ text: t('actions.done'), onPress: onHome }]);
    } catch {
      setCancellationError(t('login.tryAgain'));
    } finally {
      setCancelling(false);
    }
  };

  if (liveStatus === 'completed' && ride.id) {
    return <CustomerRideSettlement rideId={ride.id} fare={Number(liveRide?.final_fare ?? liveRide?.estimated_fare ?? 0)} captainName={captainName} paymentStatus={liveRide?.payment_status ?? 'pending'} onHome={onHome} />;
  }
  const displayedCaptainCoordinate = liveRide?.captain_latitude != null && liveRide?.captain_longitude != null
    ? { latitude: Number(liveRide.captain_latitude), longitude: Number(liveRide.captain_longitude) }
    : captainCoordinate;
  const inProgress = liveStatus === 'in_progress';
  const destinationDistanceKm = estimateCoordinateDistanceKm(displayedCaptainCoordinate, ride.dropCoordinate ?? locationCoordinate(ride.drop, 1));
  const destinationMinutes = Math.max(1, Math.ceil(destinationDistanceKm / 0.42));

  return <SafeAreaView style={styles.assignedSafe} edges={['top', 'left', 'right']}>
    <MapView ref={mapRef} provider={PROVIDER_GOOGLE} initialRegion={NANDYAL} style={StyleSheet.absoluteFill}>
      <Marker coordinate={pickup} pinColor={colors.success} title={t('rides.pickup')} />
      <Polyline coordinates={approachRoute} strokeColor={colors.primaryDark} strokeWidth={5} />
      <Marker.Animated coordinate={displayedCaptainCoordinate}><View style={styles.liveCaptainMarker}><Text style={styles.liveCaptainIcon}>🛺</Text></View></Marker.Animated>
    </MapView>
    <Pressable onPress={onHome} accessibilityRole="button" style={[styles.assignedBack, shadows.soft]}><Text style={styles.rideOptionsBackText}>‹</Text></Pressable>
    <ScrollView style={[styles.assignedSheet, shadows.card]} contentContainerStyle={styles.assignedSheetContent} showsVerticalScrollIndicator={false} bounces={false}>
      <View style={styles.sheetHandle} />
      {!arrived && <Text style={styles.bookingStatus}>{liveStatus === 'accepted' ? t('rides.bookedMessage') : t('rides.searchingSubtitle')}</Text>}
      <View style={styles.assignedHeading}><View><Text style={styles.assignedTitle}>{t(inProgress ? 'rides.startedTitle' : arrived ? 'rides.hereTitle' : 'rides.confirmedTitle')}</Text><Text style={styles.assignedSubtitle}>{inProgress ? t('rides.startedSubtitle') : arrived ? t('rides.hereSubtitle') : `${t('rides.arriving')} · ${t('rides.eta', { minutes: formatNumber(etaMinutes) })}`}</Text></View>{!arrived && <View style={styles.etaBadge}><Text style={styles.etaBadgeText}>{formatNumber(etaMinutes)} min</Text></View>}</View>
      <View style={styles.assignedCaptainRow}><View style={styles.captainAvatar}><Text style={styles.captainAvatarEmoji}>👤</Text></View><View style={styles.assignedCaptainText}><Text style={styles.captainName}>{captainName}</Text><Text style={styles.assignedVehicle}>{vehicleType ? t(`rides.${vehicleType}`) : t('rides.captain')}</Text></View></View>
      <View style={styles.assignedPickupRow}><View style={styles.assignedPickupDot} /><Text style={styles.assignedPickupText} numberOfLines={2}>{t('rides.pickup')} · {ride.pickup}</Text></View>
      {!!pickupPin && !inProgress && <View style={styles.pickupPinCard}><Text style={styles.pickupPinLabel}>{t('rides.pickupPinLabel')}</Text><Text style={styles.pickupPin}>{pickupPin}</Text><Text style={styles.pickupPinHint}>{t('rides.pickupPinHint')}</Text></View>}
      {inProgress && <><View style={styles.tripStatRow}><Text style={styles.tripStatLabel}>{t('rides.destinationDistance')}</Text><Text style={styles.tripStatValue}>{formatNumber(destinationDistanceKm, { maximumFractionDigits: 1 })} km · {formatNumber(destinationMinutes)} min</Text></View><Pressable onPress={() => { void Linking.openURL('tel:112'); }} accessibilityRole="button" style={styles.sosButton}><Text style={styles.sosText}>{t('rides.sos')}</Text></Pressable></>}
      {canCancel && <PrimaryButton label={t('rides.cancelRide')} onPress={startCancellation} danger />}
    </ScrollView>
    {cancelStep !== 'none' && <View style={styles.cancellationOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setCancelStep('none')} />
      <View style={[styles.cancellationSheet, shadows.card]}>
        <View style={styles.sheetHandle} />
        <ScrollView bounces={false} contentContainerStyle={styles.cancellationContent} showsVerticalScrollIndicator={false}>
        {cancelStep === 'confirm' ? <>
          <Text style={styles.cancellationTitle}>{t('rides.cancelTitle')}</Text>
          <View style={styles.captainStatusCard}>
            <Text style={styles.captainStatusIcon}>🛺</Text>
            <View style={styles.captainStatusText}><Text style={styles.captainStatusTitle}>{captainName}</Text><Text style={styles.captainStatusMessage}>{inProgress ? t('rides.cancelTripStatus', { distance: formatNumber(destinationDistanceKm, { maximumFractionDigits: 1 }), minutes: formatNumber(destinationMinutes) }) : t('rides.cancelCaptainStatus', { captain: captainName, distance: formatNumber(captainDistanceKm), minutes: formatNumber(etaMinutes) })}</Text></View>
          </View>
          <Text style={styles.cancellationMessage}>{t('rides.cancelConfirmMessage')}</Text>
          <PrimaryButton label={t('rides.confirmCancel')} onPress={() => setCancelStep('reason')} danger />
          <PrimaryButton label={t('rides.continueRide')} onPress={() => setCancelStep('none')} secondary />
        </> : <>
          <Text style={styles.cancellationTitle}>{t('rides.cancelReasonTitle')}</Text>
          <Text style={styles.cancellationMessage}>{t('rides.cancelReasonSubtitle')}</Text>
          <View style={styles.reasonList}>{cancellationReasons.map((reason) => {
            const selected = cancellationReason === reason.code;
            return <Pressable key={reason.code} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { setCancellationReason(reason.code); setCancellationError(''); }} style={[styles.reasonOption, selected && styles.reasonOptionSelected]}><View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioDot} />}</View><Text style={[styles.reasonOptionText, selected && styles.reasonOptionTextSelected]}>{t(`rides.cancelReason${reason.labelKey}`)}</Text></Pressable>;
          })}</View>
          {cancellationReason === 'other' && <TextInput value={otherReason} onChangeText={(value) => { setOtherReason(value); setCancellationError(''); }} placeholder={t('rides.cancelReasonOtherPlaceholder')} placeholderTextColor={colors.textMuted} multiline maxLength={180} style={styles.otherReasonInput} />}
          {!!cancellationError && <Text style={styles.cancellationError}>{cancellationError}</Text>}
          <PrimaryButton label={cancelling ? t('login.pleaseWait') : t('rides.submitCancellation')} onPress={() => { void submitCancellation(); }} disabled={cancelling} danger />
          <Pressable disabled={cancelling} onPress={() => setCancelStep('confirm')} style={styles.backToCancel}><Text style={styles.backToCancelText}>{t('actions.cancel')}</Text></Pressable>
        </>}
        </ScrollView>
      </View>
    </View>}
  </SafeAreaView>;
}

/* ─────────────────────────── STYLES ─────────────────────────── */

const styles = StyleSheet.create({
  // Map-led customer home
  mapHomeSafe: { flex: 1, backgroundColor: colors.primaryLight },
  mapHomeTopBar: { alignItems: 'flex-start', paddingHorizontal: 18, paddingTop: 8 },
  mapHomeBrand: { backgroundColor: 'rgba(255,255,255,0.94)', borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, ...shadows.soft },
  mapHomeBrandText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  mapHomeBrandTe: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, marginTop: 1 },
  recenterButton: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, height: 50, justifyContent: 'center', position: 'absolute', right: 18, top: 76, width: 50, zIndex: 2 },
  recenterIcon: { color: colors.primary, fontSize: 29, fontWeight: '800', lineHeight: 32 },
  currentLocationDot: { backgroundColor: '#14B8A6', borderColor: '#FFFFFF', borderRadius: 13, borderWidth: 4, height: 26, width: 26, ...shadows.card },
  mapFallback: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: radii.pill, left: 20, paddingHorizontal: 14, paddingVertical: 8, position: 'absolute', right: 78, top: 90 },
  mapFallbackText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, textAlign: 'center' },
  locationNotice: { backgroundColor: colors.accentLight, borderColor: '#F6C7B4', borderRadius: radii.md, borderWidth: 1, left: 20, paddingHorizontal: 12, paddingVertical: 9, position: 'absolute', right: 20, top: 92 },
  locationNoticeText: { color: colors.accent, fontFamily, fontSize: fontSize.xs, fontWeight: '700', textAlign: 'center' },
  homeSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 76, left: 0, overflow: 'hidden', position: 'absolute', right: 0 },
  sheetHandleArea: { alignItems: 'center', minHeight: 52, paddingBottom: 14, paddingTop: 15 },
  sheetHandle: { backgroundColor: '#CBC5BB', borderRadius: radii.pill, height: 5, width: 46 },
  homeSheetContent: { flex: 1, gap: 14, paddingBottom: 18, paddingHorizontal: 16 },
  destinationAction: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: radii.lg, flexDirection: 'row', minHeight: 74, paddingHorizontal: 16, ...shadows.button },
  destinationPin: { color: colors.bgAlt, fontSize: 28, marginRight: 12 },
  destinationTextWrap: { flex: 1 },
  destinationLabel: { color: colors.bgAlt, fontFamily, fontSize: fontSize.lg, fontWeight: '800' },
  destinationSub: { color: '#B5E7DD', fontFamily, fontSize: fontSize.xs, marginTop: 2 },
  destinationArrow: { color: colors.bgAlt, fontSize: 26, fontWeight: '800' },
  savedRow: { flexDirection: 'row', gap: 10 },
  savedPlace: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 10, minHeight: 62, paddingHorizontal: 12 },
  savedPlaceIcon: { color: colors.primary, fontSize: 25 },
  savedPlaceText: { flex: 1 },
  savedPlaceLabel: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  savedPlaceSub: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, marginTop: 1 },
  homeExpandedOnly: { gap: 12 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  homeSectionTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  homeSectionLink: { color: colors.primary, fontFamily, fontSize: fontSize.xs, fontWeight: '700' },
  landmarkRow: { flexDirection: 'row', gap: 8 },
  landmarkCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, minHeight: 92, paddingHorizontal: 5, paddingTop: 9 },
  landmarkIcon: { color: colors.primary, fontSize: 22, marginBottom: 5 },
  landmarkText: { color: colors.textPrimary, fontFamily, fontSize: 11, lineHeight: 15, textAlign: 'center' },
  safetyCard: { alignItems: 'center', backgroundColor: colors.accentLight, borderColor: '#F6C7B4', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 64, paddingHorizontal: 13 },
  safetyIcon: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: radii.pill, color: colors.textOnAccent, fontSize: 17, fontWeight: '900', height: 28, lineHeight: 28, textAlign: 'center', width: 28 },
  safetyTextWrap: { flex: 1 },
  safetyTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  safetySubtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, marginTop: 2 },
  safetyArrow: { color: colors.accent, fontSize: 26 },
  homeTabBar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', left: 0, minHeight: 76, paddingBottom: 11, paddingTop: 9, position: 'absolute', right: 0, zIndex: 3 },
  homeTab: { alignItems: 'center', flex: 1, gap: 2, minWidth: 0 },
  homeTabIcon: { color: colors.textMuted, fontSize: 23, lineHeight: 25 },
  homeTabIconActive: { color: colors.primary },
  homeTabLabel: { color: colors.textMuted, fontFamily, fontSize: 11 },
  homeTabLabelActive: { color: colors.primaryDark, fontWeight: '800' },

  // Pickup and destination form
  locationFormIntro: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 22 },
  locationFormCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, overflow: 'hidden' },
  locationField: { alignItems: 'center', flexDirection: 'row', minHeight: 76, paddingHorizontal: 15 },
  locationFieldActive: { backgroundColor: '#F9FCFB' },
  locationFieldDot: { alignItems: 'center', backgroundColor: colors.successLight, borderRadius: radii.pill, height: 26, justifyContent: 'center', marginRight: 12, width: 26 },
  locationFieldDotDrop: { backgroundColor: '#F7E2DE' },
  locationFieldDotText: { color: colors.success, fontSize: 14, lineHeight: 18 },
  locationFieldDotTextDrop: { color: '#B7655A' },
  locationFieldTextWrap: { flex: 1 },
  locationFieldLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, fontWeight: '700' },
  locationFieldInput: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, minHeight: 34, padding: 0 },
  locationFieldDivider: { backgroundColor: colors.divider, height: 1, marginLeft: 53 },
  pinFallback: { backgroundColor: colors.primaryLight, borderColor: '#BFE8DE', borderRadius: radii.lg, borderWidth: 1, gap: 8, padding: 14 },
  pinFallbackTitle: { color: colors.primaryDark, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  pinFallbackHint: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 21 },

  // Full-screen pin drop: pin is an overlay while the native map moves underneath.
  pinPickerSafe: { flex: 1, backgroundColor: colors.primaryLight },
  fixedPinWrap: { alignItems: 'center', left: 0, marginTop: -25, position: 'absolute', right: 0, top: '42%' },
  fixedPin: { alignItems: 'center', backgroundColor: colors.accent, borderColor: colors.surface, borderRadius: radii.pill, borderWidth: 4, height: 40, justifyContent: 'center', width: 40, ...shadows.card },
  fixedPinText: { color: colors.textOnAccent, fontSize: 16 },
  fixedPinStem: { backgroundColor: colors.accent, height: 18, width: 4 },
  pinPickerBack: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 48, justifyContent: 'center', left: 18, position: 'absolute', top: 14, width: 48 },
  pinPickerBackText: { color: colors.textPrimary, fontSize: 35, lineHeight: 37, marginTop: -4 },
  pinPickerSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 0, gap: 15, left: 0, padding: 18, paddingBottom: 24, position: 'absolute', right: 0 },
  pinPickerTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '800' },
  pinAddressCard: { alignItems: 'flex-start', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 70, padding: 13 },
  pinAddressIcon: { color: colors.accent, fontSize: 19 },
  pinAddressText: { color: colors.textSecondary, flex: 1, fontFamily, fontSize: fontSize.sm, lineHeight: 20 },

  // Route preview
  routePreview: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, overflow: 'hidden' },
  routeMap: { height: 210, width: '100%' },
  routePreviewLabel: { backgroundColor: colors.surface, gap: 3, paddingHorizontal: 14, paddingVertical: 11 },
  routePreviewTitle: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  routePreviewPlaces: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs },
  captainMarker: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.primary, borderRadius: radii.pill, borderWidth: 2, height: 32, justifyContent: 'center', width: 32, ...shadows.soft },
  captainMarkerText: { fontSize: 16 },

  // Map-led ride selection sheet
  rideOptionsSafe: { flex: 1, backgroundColor: colors.primaryLight },
  rideOptionsTop: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  rideOptionsBack: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 46, justifyContent: 'center', width: 46 },
  rideOptionsBackText: { color: colors.textPrimary, fontSize: 34, lineHeight: 36, marginTop: -4 },
  routeSummary: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 7, height: 48, paddingHorizontal: 12 },
  routeSummaryDot: { color: colors.success, fontSize: 15 },
  routeSummaryText: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.xs, fontWeight: '700' },
  routeSummaryArrow: { color: colors.accent, fontSize: 16, fontWeight: '800' },
  rideOptionsSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 0, gap: 12, left: 0, padding: 16, paddingBottom: 22, position: 'absolute', right: 0 },
  rideOptionsHeading: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  rideOptionList: { gap: 2 },
  rideOptionsExtras: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', height: 48, justifyContent: 'space-around' },
  rideOptionsExtra: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '700' },
  rideOptionsDivider: { backgroundColor: colors.divider, height: 24, width: 1 },

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
    backgroundColor: '#F9FCFB',
    borderColor: colors.primary,
    borderRadius: radii.md,
    borderWidth: 1.5,
    minHeight: 60,
    paddingHorizontal: 16,
    color: colors.textPrimary,
    fontFamily: 'System',
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: 2,
    textAlignVertical: 'center',
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
  liveLocationNote: {
    color: colors.primaryDark,
    fontFamily,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textAlign: 'center',
  },
  locationError: {
    color: colors.error,
    fontFamily,
    fontSize: fontSize.sm,
    lineHeight: 20,
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
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    borderRadius: radii.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 10,
    minHeight: 70,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rideCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  rideIconBadge: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderRadius: 0,
    height: 46,
    justifyContent: 'center',
    width: 48,
  },
  rideIcon: { fontSize: 28 },
  rideTextWrap: { flex: 1, gap: 2 },
  rideName: {
    color: colors.textPrimary,
    fontFamily,
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  rideDetail: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.xs,
  },
  rideFare: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '800' },
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

  // Captain assigned: same seamless map + sheet composition as ride selection.
  assignedSafe: { flex: 1, backgroundColor: colors.primaryLight },
  assignedBack: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 46, justifyContent: 'center', left: 16, position: 'absolute', top: 18, width: 46 },
  assignedSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 0, left: 0, maxHeight: '68%', position: 'absolute', right: 0 },
  assignedSheetContent: { gap: 13, padding: 16, paddingBottom: 22 },
  bookingStatus: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  assignedHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  assignedTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '800' },
  assignedSubtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, marginTop: 3 },
  etaBadge: { backgroundColor: colors.primaryLight, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7 },
  etaBadgeText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  assignedCaptainRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 10 },
  assignedCaptainText: { flex: 1 },
  assignedVehicle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, marginTop: 2 },
  assignedCall: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 38, justifyContent: 'center', width: 38 },
  assignedCallText: { color: colors.primary, fontSize: 20 },
  assignedPickupRow: { alignItems: 'flex-start', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 9, paddingHorizontal: 12, paddingVertical: 11 },
  pickupPinCard: { alignItems: 'center', backgroundColor: colors.primaryLight, borderColor: colors.primary, borderRadius: radii.lg, borderWidth: 1, gap: 5, padding: 14 },
  pickupPinLabel: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '900' },
  pickupPin: { color: colors.primary, fontFamily, fontSize: 34, fontWeight: '900', letterSpacing: 8 },
  pickupPinHint: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, textAlign: 'center' },
  tripStatRow: { alignItems: 'center', backgroundColor: colors.surfaceMint, borderRadius: radii.md, flexDirection: 'row', justifyContent: 'space-between', padding: 13 },
  tripStatLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm },
  tripStatValue: { color: colors.primaryDark, fontFamily, fontSize: fontSize.lg, fontWeight: '900' },
  sosButton: { alignItems: 'center', backgroundColor: colors.error, borderRadius: radii.pill, minHeight: 52, justifyContent: 'center' },
  sosText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  assignedPickupDot: { backgroundColor: colors.success, borderRadius: radii.pill, height: 10, marginTop: 6, width: 10 },
  assignedPickupText: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.md, fontWeight: '800', lineHeight: 23 },
  cancellationOverlay: { backgroundColor: 'rgba(35, 29, 24, 0.52)', bottom: 0, justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 10 },
  cancellationSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, maxHeight: '88%', paddingBottom: 28, paddingHorizontal: 20, paddingTop: 14 },
  cancellationContent: { gap: 14 },
  cancellationTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize['2xl'], fontWeight: '900', textAlign: 'center' },
  cancellationMessage: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, lineHeight: 23, textAlign: 'center' },
  captainStatusCard: { alignItems: 'center', backgroundColor: colors.primaryLight, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 14 },
  captainStatusIcon: { fontSize: 30 }, captainStatusText: { flex: 1, gap: 3 }, captainStatusTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, captainStatusMessage: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 19 },
  reasonList: { gap: 8 }, reasonOption: { alignItems: 'center', backgroundColor: colors.bg, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 12, minHeight: 50, paddingHorizontal: 14 }, reasonOptionSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 2 },
  radio: { alignItems: 'center', borderColor: colors.textMuted, borderRadius: 10, borderWidth: 2, height: 20, justifyContent: 'center', width: 20 }, radioSelected: { borderColor: colors.primary }, radioDot: { backgroundColor: colors.primary, borderRadius: 5, height: 10, width: 10 },
  reasonOptionText: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.sm, fontWeight: '700' }, reasonOptionTextSelected: { color: colors.primaryDark, fontWeight: '900' },
  otherReasonInput: { backgroundColor: colors.bg, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, fontFamily, fontSize: fontSize.md, minHeight: 82, padding: 12, textAlignVertical: 'top' },
  cancellationError: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '800', textAlign: 'center' }, backToCancel: { alignItems: 'center', paddingVertical: 4 }, backToCancelText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  liveCaptainMarker: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.primary, borderRadius: radii.pill, borderWidth: 3, height: 42, justifyContent: 'center', width: 42, ...shadows.card },
  liveCaptainIcon: { fontSize: 22 },

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
