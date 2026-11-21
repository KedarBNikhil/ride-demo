import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Image,
  Keyboard,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { clamp, runOnJS, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import MapView, { Marker, type MapMarker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CircleUserRound, House } from 'lucide-react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { useDialog } from '../components/ThemedDialog';
import { ScreenHeader, ScreenShell } from '../components/ScreenShell';
import { PhoneOtpAuth } from '../components/PhoneOtpAuth';
import { customerAuthService } from '../services/customerAuth';
import { toIndianE164 } from '../services/authMode';
import { rideCreationService, type CancellationReason } from '../services/rideCreation';
import { isCustomerActiveRideStatus, rideDispatchService, type AssignedCaptainDetails, type CustomerCoupon, type CustomerIssueHistoryItem, type CustomerPromotionStatus, type DispatchRide, type RideStatus } from '../services/rideDispatch';
import { googleMapsService, type PlaceSuggestion, type RouteDistanceCandidate } from '../services/googleMaps';
import { offlineLocationCatalogue, type OfflineLocation } from '../services/offlineLocationCatalogue';
import { decodeGooglePolyline } from '../utils/polyline';
import { calculateFare } from '../services/fareEngine';
import { legalOperator } from '../legal/legalDocuments';
import { emergencyContactsService } from '../services/emergencyContacts';
import { straightLineDistanceMeters } from '../services/distanceProvider';
import { LiveLocationMap, LiveLocationMarker } from '../components/LiveLocationMap';
import { CustomerRideSettlement } from './CustomerRideSettlement';
import { OutstandingBalanceCard } from '../components/OutstandingBalanceCard';
import { formatFare, formatNumber, formatOtp } from '../utils/format';
import { defaultRideHistoryFilter, filterAndSortRideHistory, type RideHistoryFilter } from '../utils/rideHistory';
import { RideHistoryFilterControl } from '../components/RideHistoryFilter';
import { colors, radii, shadows, fontFamily, fontFamilyBold, fontFamilyExtraBold, fontFamilyMedium, fontFamilySemiBold, fontSize } from '../theme';
import { selectionHaptic } from '../utils/haptics';
import { useBottomTabBarMetrics } from '../utils/safeAreaLayout';
import { centerCoordinateInVisibleViewport, fitRouteInVisibleViewport, getVisibleMapPadding, HOME_LOCATION_DELTA, isValidMapCoordinate } from '../utils/mapCamera';
import { DraggableMapSheet } from '../components/DraggableMapSheet';
import { missingCustomerBookingLocation, toCustomerBookingConfirmationSnapshot } from '../services/customerBookingDraft';
import { customerSavedAddressesService, type SavedAddress } from '../services/customerSavedAddresses';
import type { AppLanguage } from '../i18n/createI18n';

const mapProvider = Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined;

const sawaariHomeFooter = require('../../assets/images/sawaari-brand-nandyal.png');
const sawaariWelcomeJourneyArtwork = require('../../assets/images/sawaari-welcome-journey-artwork.png');
const sawaariWelcomeCaptainRideArtwork = require('../../assets/images/sawaari-welcome-captain-ride-artwork.png');
const sawaariBikeIcon = require('../../assets/icons/sawaari-bike.png');
const sawaariAutoIcon = require('../../assets/icons/sawaari-auto.png');

export type RideKind = 'bike' | 'auto';
export type Coordinate = { latitude: number; longitude: number };
type NearbyCaptainLocation = { id: string; coordinate: Coordinate; vehicleType: RideKind };
export type RouteQuote = { id: string; distanceMeters: number; durationSeconds: number; encodedPolyline: string };
export type PaymentPreference = 'cash' | 'upi';
export type UpiApp = 'gpay' | 'phonepe' | 'paytm';
export type CustomerRide = { id?: string; pickup: string; drop: string; kind: RideKind; passengerCount: number; pickupCoordinate?: Coordinate; dropCoordinate?: Coordinate; routeQuote?: RouteQuote; pickupOtp?: string; paymentPreference?: PaymentPreference; preferredUpiApp?: UpiApp };
type LocationTarget = 'pickup' | 'drop';
type CustomerFareDisplay = { originalEstimatedFare: number | null; customerCharge: number | null; finalFare: number | null; routeDistanceMeters: number | null; isFree: boolean; promotionAvailable: boolean };
const NANDYAL: Region = { latitude: 15.4889, longitude: 78.4836, latitudeDelta: 0.035, longitudeDelta: 0.035 };
let customerRideHistorySnapshot: DispatchRide[] | null = null;
const estimateCoordinateDistanceKm = (a: Coordinate, b: Coordinate) => Math.sqrt((a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2) * 111;

function formatRideArrivalTime(timestamp: string, language: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'te' ? 'te-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function formatRoadDistance(distanceMeters: number) {
  if (distanceMeters < 1_000) return `${Math.max(1, Math.round(distanceMeters / 100) * 100)} m`;
  return `${formatNumber(distanceMeters / 1_000, { maximumFractionDigits: 1 })} km`;
}

function rideCardStatusLabel(ride: DispatchRide, language: string, completed: string, cancelled: string) {
  const timestamp = ride.status === 'completed' ? ride.completed_at : ride.status === 'cancelled' ? ride.cancelled_at : null;
  if (!timestamp) return ride.status === 'completed' ? completed : ride.status === 'cancelled' ? cancelled : '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return ride.status === 'completed' ? completed : cancelled;
  const formatted = new Intl.DateTimeFormat(language === 'te' ? 'te-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
  return `${ride.status === 'completed' ? completed : cancelled} at ${formatted}`;
}

function VehicleIcon({ kind, size }: { kind: RideKind; size: number }) {
  return <Image accessibilityIgnoresInvertColors resizeMode="contain" source={kind === 'bike' ? sawaariBikeIcon : sawaariAutoIcon} style={{ height: size, width: size }} />;
}

const SearchingCaptainMarker = React.memo(function SearchingCaptainMarker({ captain }: { captain: NearbyCaptainLocation }) {
  const marker = useRef<MapMarker>(null);
  const previousCoordinate = useRef(captain.coordinate);
  useEffect(() => {
    const previous = previousCoordinate.current;
    if (previous.latitude !== captain.coordinate.latitude || previous.longitude !== captain.coordinate.longitude) marker.current?.animateMarkerToCoordinate(captain.coordinate, 700);
    previousCoordinate.current = captain.coordinate;
  }, [captain.coordinate]);
  return <Marker ref={marker} coordinate={captain.coordinate} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}><View style={styles.searchingCaptainMarker}><VehicleIcon kind={captain.vehicleType} size={26} /></View></Marker>;
});

const SearchingMap = React.memo(function SearchingMap({ pickup, searchKey, nearbyCaptains = [], heartbeatScale, heartbeatOpacity }: { pickup?: Coordinate; searchKey?: string; nearbyCaptains?: NearbyCaptainLocation[]; heartbeatScale: Animated.Value; heartbeatOpacity: Animated.Value }) {
  const mapRef = useRef<MapView>(null);
  const [pickupPoint, setPickupPoint] = useState<{ x: number; y: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const region = useMemo<Region>(() => isValidMapCoordinate(pickup) ? { ...pickup, latitudeDelta: HOME_LOCATION_DELTA, longitudeDelta: HOME_LOCATION_DELTA } : NANDYAL, [pickup]);
  useEffect(() => {
    if (!mapReady || !isValidMapCoordinate(pickup)) return;
    // `initialRegion` is intentionally not trusted after a retry: this screen
    // can stay mounted while a new ride gets a new pickup coordinate.
    mapRef.current?.animateToRegion({ ...pickup, latitudeDelta: HOME_LOCATION_DELTA, longitudeDelta: HOME_LOCATION_DELTA }, 0);
  }, [mapReady, pickup?.latitude, pickup?.longitude, searchKey]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!pickup || !mapRef.current) return setPickupPoint(null);
      void mapRef.current.pointForCoordinate(pickup).then(setPickupPoint).catch(() => setPickupPoint(null));
    });
    return () => cancelAnimationFrame(frame);
  }, [pickup]);
  return <View style={StyleSheet.absoluteFill}>
    <MapView ref={mapRef} provider={mapProvider} initialRegion={region} scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} onMapReady={() => { setMapReady(true); if (isValidMapCoordinate(pickup) && mapRef.current) void mapRef.current.pointForCoordinate(pickup).then(setPickupPoint).catch(() => setPickupPoint(null)); }} style={StyleSheet.absoluteFill}>
      {pickup && <Marker coordinate={pickup} pinColor={colors.success} tracksViewChanges={false} />}
      {nearbyCaptains.slice(0, 3).map((captain) => <SearchingCaptainMarker key={captain.id} captain={captain} />)}
    </MapView>
    {pickupPoint && !nearbyCaptains.length && <Animated.View pointerEvents="none" style={[styles.searchingHeartbeat, { left: pickupPoint.x - 145, top: pickupPoint.y - 145, opacity: heartbeatOpacity, transform: [{ scale: heartbeatScale }] }]}><View style={styles.searchingHeartbeatInner} /></Animated.View>}
  </View>;
});

function MapGpsButton({ accessibilityLabel, disabled = false, onPress }: { accessibilityLabel: string; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.mapGpsButton, shadows.card, (pressed || disabled) && styles.mapGpsButtonPressed]}><Text style={styles.recenterIcon}>⌖</Text></Pressable>;
}

async function getCustomerGpsPosition() {
  const existing = await Location.getForegroundPermissionsAsync();
  const permission = existing.status === 'granted' ? existing : await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('LOCATION_PERMISSION_DENIED');
  const cached = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 500 });
  return cached ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
}

function newPlacesSessionToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

function coordinateFromPosition(position: Location.LocationObject): Coordinate {
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

function hasUsableRouteQuote(quote: RouteQuote | undefined): quote is RouteQuote {
  return Boolean(
    typeof quote?.id === 'string' && quote.id &&
    Number.isFinite(quote.distanceMeters) && quote.distanceMeters > 0 &&
    Number.isFinite(quote.durationSeconds) && quote.durationSeconds > 0 &&
    typeof quote.encodedPolyline === 'string' && quote.encodedPolyline &&
    decodeGooglePolyline(quote.encodedPolyline).length > 1,
  );
}

function getCustomerFareDisplay({ kind, passengerCount, routeQuote, promotion, backendRide }: { kind: RideKind; passengerCount: number; routeQuote?: RouteQuote; promotion?: CustomerPromotionStatus | null; backendRide?: DispatchRide | null }): CustomerFareDisplay {
  const routeDistanceMeters = backendRide?.pricing_distance_meters ?? backendRide?.trip_distance_meters ?? routeQuote?.distanceMeters ?? null;
  const calculatedEstimate = routeQuote && hasUsableRouteQuote(routeQuote)
    ? calculateFare({ rideType: kind, passengerCount: kind === 'bike' ? 1 : passengerCount, tripDistanceMeters: routeQuote.distanceMeters }).total
    : null;
  const originalEstimatedFare = backendRide ? Number(backendRide.estimated_fare ?? calculatedEstimate ?? 0) : calculatedEstimate;
  const promotionAvailable = Boolean(promotion?.promotion_enabled && promotion.remaining_free_rides > 0 && routeDistanceMeters != null && routeDistanceMeters <= promotion.maximum_free_distance_meters);
  const isFree = backendRide ? backendRide.customer_charge_type === 'free' && Number(backendRide.customer_charge_amount ?? 0) === 0 : promotionAvailable;
  const finalFare = backendRide?.final_fare == null ? null : Number(backendRide.final_fare);
  return { originalEstimatedFare, customerCharge: backendRide ? Number(backendRide.customer_charge_amount ?? finalFare ?? originalEstimatedFare ?? 0) : isFree ? 0 : originalEstimatedFare, finalFare, routeDistanceMeters, isFree, promotionAvailable };
}

/* ─────────────────────────── LOGIN ─────────────────────────── */

export function CustomerLoginScreen({
  onComplete,
  onBack,
  language,
  onLanguageChange,
}: {
  onComplete: () => void;
  onBack?: () => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const chooseLanguage = () => {
    selectionHaptic();
    dialog({ title: t('language.choose'), buttons: [
      { text: t('language.english'), onPress: () => { selectionHaptic(); onLanguageChange('en'); } },
      { text: t('language.telugu'), onPress: () => { selectionHaptic(); onLanguageChange('te'); } },
    ] });
  };
  return <PhoneOtpAuth customerLoginLayout languageLabel={language === 'te' ? 'తె' : 'EN'} onLanguagePress={chooseLanguage} title={t('login.customerLoginTitle')} subtitle={t('login.customerLoginSubtitle')} emoji="" onBack={onBack} onSendOtp={async (phone) => {
    const result = await customerAuthService.sendLoginOtp(phone);
    if (!result.requested) {
      dialog({ title: 'Login', message: "This number doesn't have an account. Please signup to start using Sawaari with this number.", buttons: [{ text: 'OK' }] });
      return false;
    }
    return result;
  }} onVerifyOtp={async (phone, otp) => { await customerAuthService.verifyOtp(phone, otp); onComplete(); }} />;
}

export function CustomerIntroScreen({ onComplete }: { onComplete: () => void }) {
  const brandOpacity = useRef(new Animated.Value(0)).current;
  const brandTranslateY = useRef(new Animated.Value(14)).current;
  const brandScale = useRef(new Animated.Value(0.94)).current;
  const footerOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(brandOpacity, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(brandTranslateY, { toValue: 0, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(brandScale, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(footerOpacity, { toValue: 1, duration: 360, delay: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onComplete(); });
  }, [brandOpacity, brandScale, brandTranslateY, footerOpacity, onComplete]);

  return <SafeAreaView style={styles.introSafe} edges={['top', 'right', 'bottom', 'left']}>
    <View style={styles.introContent}>
      <Animated.Text style={[styles.introBrand, { opacity: brandOpacity, transform: [{ translateY: brandTranslateY }, { scale: brandScale }] }]}>Sawaari</Animated.Text>
      <Animated.Text style={[styles.introFooter, { opacity: footerOpacity }]}>Made with love ❤️ for Nandyal</Animated.Text>
    </View>
  </SafeAreaView>;
}

export function CustomerAuthChoiceScreen({ onLogin, onSignup, language, onLanguageChange }: { onLogin: () => void; onSignup: () => void; language: AppLanguage; onLanguageChange: (language: AppLanguage) => void }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const { height, width } = useWindowDimensions();
  const [artworkPage, setArtworkPage] = useState(0);
  const artworkHeight = Math.min(360, Math.max(280, height * 0.4));
  const chooseLanguage = () => {
    selectionHaptic();
    dialog({
    title: t('language.choose'),
    buttons: [
      { text: t('language.english'), onPress: () => { selectionHaptic(); onLanguageChange('en'); } },
      { text: t('language.telugu'), onPress: () => { selectionHaptic(); onLanguageChange('te'); } },
    ],
    });
  };
  const onArtworkScrollEnd = (offsetX: number) => {
    const nextPage = Math.round(offsetX / width);
    if (nextPage !== artworkPage) {
      selectionHaptic();
      setArtworkPage(nextPage);
    }
  };

  return <SafeAreaView style={styles.authChoiceSafe} edges={['top', 'right', 'bottom', 'left']}>
    <View style={styles.authChoiceTopBar}>
      <Text style={styles.authChoiceBrand}>{t('authChoice.brand')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('language.change')} onPress={chooseLanguage} style={styles.authChoiceLanguageButton}>
        <Text style={styles.authChoiceLanguageLabel}>{language === 'te' ? 'తె' : 'EN'}</Text>
      </Pressable>
    </View>
    <View style={[styles.authChoiceArtworkArea, { height: artworkHeight }]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => onArtworkScrollEnd(event.nativeEvent.contentOffset.x)}
      >
        <Image accessibilityIgnoresInvertColors resizeMode="cover" source={sawaariWelcomeJourneyArtwork} style={[styles.authChoiceArtwork, { width }]} />
        <Image accessibilityIgnoresInvertColors resizeMode="cover" source={sawaariWelcomeCaptainRideArtwork} style={[styles.authChoiceArtwork, { width }]} />
      </ScrollView>
    </View>
    <View accessibilityRole="adjustable" accessibilityLabel={`Welcome illustration ${artworkPage + 1} of 2`} style={styles.authChoicePagination}>
      {[0, 1].map((page) => <View key={page} style={[styles.authChoicePaginationDot, artworkPage === page && styles.authChoicePaginationDotActive]} />)}
    </View>
    <View style={styles.authChoiceContent}>
      <View style={styles.authChoiceCopy}>
        <Text style={styles.authChoiceTitle}>{t('authChoice.welcome')}</Text>
        <Text style={styles.authChoiceHelp}>{t('authChoice.subtitle')}</Text>
        <Pressable accessibilityRole="button" onPress={() => { selectionHaptic(); onLogin(); }} style={styles.authChoicePrimaryButton}><Text style={styles.authChoicePrimaryButtonText}>{t('authChoice.login')}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => { selectionHaptic(); onSignup(); }} style={styles.authChoiceSecondaryButton}><Text style={styles.authChoiceSecondaryButtonText}>{t('authChoice.signup')}</Text></Pressable>
        <Text style={styles.authChoiceLegal}>{t('authChoice.legal')}</Text>
      </View>
    </View>
  </SafeAreaView>;
}

export function CustomerSignupScreen({ onComplete, onBack, language, onLanguageChange }: { onComplete: () => void; onBack: () => void; language: AppLanguage; onLanguageChange: (language: AppLanguage) => void }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [addressType, setAddressType] = useState<'home' | 'work' | null>(null);
  const validPhone = () => {
    try { toIndianE164(phone); return true; } catch { return false; }
  };

  const chooseLanguage = () => {
    selectionHaptic();
    dialog({ title: t('language.choose'), buttons: [
      { text: t('language.english'), onPress: () => { selectionHaptic(); onLanguageChange('en'); } },
      { text: t('language.telugu'), onPress: () => { selectionHaptic(); onLanguageChange('te'); } },
    ] });
  };
  const details = <View style={styles.signupDetails}>
    <Text style={styles.signupLabel}>{t('login.nameLabel')}<Text style={styles.signupRequired}>*</Text></Text>
    <TextInput value={name} onChangeText={setName} autoCapitalize="words" placeholder={t('login.namePlaceholder')} placeholderTextColor={colors.textMuted} style={styles.signupInput} />
    <Text style={styles.signupLabel}>{t('login.customerPhoneLabel')}<Text style={styles.signupRequired}>*</Text></Text>
    <View style={styles.signupPhoneRow}><View accessibilityLabel="Country code +91" style={styles.signupCountryCode}><Text style={styles.signupCountryCodeText}>+91</Text></View><TextInput value={phone} onChangeText={(next) => setPhone(next.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" placeholder={t('login.yourPhonePlaceholder')} placeholderTextColor={colors.textMuted} style={styles.signupPhoneInput} /></View>
    <Text style={styles.signupLabel}>{t('login.addressLabel')} <Text style={styles.signupOptional}>({t('login.optional')})</Text></Text>
    <TextInput value={address} onChangeText={setAddress} placeholder={t('login.addressPlaceholder')} placeholderTextColor={colors.textMuted} style={styles.signupInput} />
    <View style={styles.addressTypes}>{(['home', 'work'] as const).map((type) => <Pressable key={type} onPress={() => { selectionHaptic(); setAddressType(type); }} style={[styles.addressType, addressType === type && styles.addressTypeActive]}><Text style={[styles.addressTypeText, addressType === type && styles.addressTypeTextActive]}>{type === 'home' ? t('home.home') : t('home.work')}</Text></Pressable>)}</View>
  </View>;
  return <PhoneOtpAuth customerSignupLayout languageLabel={language === 'te' ? 'తె' : 'EN'} onLanguagePress={chooseLanguage} title={t('login.signupTitle')} subtitle={t('login.signupSubtitle')} emoji="" phoneStepLabel="" onBack={onBack} initialPhone={phone} phoneStepContent={details} canSendOtp={Boolean(name.trim() && validPhone())} onSendOtp={async (value) => {
    setPhone(value);
    if (await customerAuthService.accountExists(value)) {
      dialog({ title: 'Sign up', message: 'This number already has an account. Please use Login to continue.', buttons: [{ text: 'OK' }] });
      return false;
    }
    await customerAuthService.sendOtp(value);
  }} onVerifyOtp={async (value, otp) => { await customerAuthService.verifyOtp(value, otp); await customerAuthService.saveSignupProfile(name); onComplete(); }} />;
}

/* ─────────────────────────── HOME ─────────────────────────── */

export function CustomerHomeScreen({
  ride,
  onPickLocation,
  onChooseDestination,
  onStartBooking,
  onPickupHere,
  onBookings,
  hasActiveRide,
  onProfile,
  onBack,
  onSaveDestination,
  ratingPrompt,
  onDismissRating,
  onSkipRating,
}: {
  ride: CustomerRide;
  onPickLocation: (target: LocationTarget) => void;
  onChooseDestination: (place: string, coordinate: Coordinate, pickup?: string, pickupCoordinate?: Coordinate) => void;
  onStartBooking: (pickup: string, coordinate: Coordinate) => void;
  onPickupHere: (pickup: string, coordinate: Coordinate) => void;
  onBookings: () => void;
  hasActiveRide: boolean;
  onProfile: () => void;
  onBack: () => void;
  onSaveDestination: (address: string, coordinate: Coordinate) => void;
  ratingPrompt?: { rideId: string; captainName: string } | null;
  onDismissRating: () => void;
  onSkipRating: (rideId: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const mapRef = useRef<MapView>(null);
  const { height: windowHeight } = useWindowDimensions();
  const { tabBarHeight } = useBottomTabBarMetrics();
  const sheetHeight = Math.min(680, Math.max(320, windowHeight - tabBarHeight));
  const collapsedOffset = Math.max(142, sheetHeight - 278);
  const sheetOffset = useSharedValue(collapsedOffset);
  const sheetDragStart = useSharedValue(collapsedOffset);
  const sheetScrollOffset = useSharedValue(0);
  const sheetCanDrag = useSharedValue(true);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [cachedAddress, setCachedAddress] = useState('');
  const [locationUnavailable, setLocationUnavailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapViewportHeight, setMapViewportHeight] = useState(0);
  const [sheetPosition, setSheetPosition] = useState(collapsedOffset);
  const [pickupMarkerReset, setPickupMarkerReset] = useState(0);
  const [promotion, setPromotion] = useState<CustomerPromotionStatus | null>(null);
  const [recentRides, setRecentRides] = useState<DispatchRide[]>(() => customerRideHistorySnapshot ?? []);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const pendingInitialRecenter = useRef<Coordinate | null>(null);
  const initialHomeCameraApplied = useRef(false);
  const freshLocationRequest = useRef<Promise<Location.LocationObject> | null>(null);
  const requestFreshLocation = () => {
    if (!freshLocationRequest.current) freshLocationRequest.current = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).finally(() => { freshLocationRequest.current = null; });
    return freshLocationRequest.current;
  };

  useEffect(() => {
    let active = true;
    let subscription: Location.LocationSubscription | null = null;
    let firstFix = true;
    const applyLocation = async (position: Location.LocationObject) => {
      if (!active) return;
      const coordinate = coordinateFromPosition(position);
      setUserLocation(coordinate);
      setLocationUnavailable(false);
      if (firstFix) {
        firstFix = false;
        setPickupMarkerReset((token) => token + 1);
        pendingInitialRecenter.current = coordinate;
        const address = await reverseGeocodeAddress(coordinate, t('location.gpsDefault'));
        if (active) setCachedAddress(address);
      }
    };
    const start = async () => {
      try {
        const existing = await Location.getForegroundPermissionsAsync();
        const permission = existing.status === 'granted' ? existing : await Location.requestForegroundPermissionsAsync();
        if (!active || permission.status !== 'granted') throw new Error('LOCATION_PERMISSION_DENIED');
        const cached = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 500 });
        if (cached) applyLocation(cached);
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 10_000 },
          (next) => { if (active) void applyLocation(next); },
          () => { if (active && !userLocation) setLocationUnavailable(true); },
        );
        void requestFreshLocation().then((next) => { if (active) void applyLocation(next); }).catch(() => { if (active && !cached) setLocationUnavailable(true); });
      } catch { if (active) setLocationUnavailable(true); }
    };
    void start();
    return () => { active = false; subscription?.remove(); };
  }, [t]);
  const refreshPromotion = useCallback(() => { void rideDispatchService.getCustomerPromotionStatus().then(setPromotion).catch(() => setPromotion(null)); }, []);
  useFocusEffect(refreshPromotion);

  const refreshRecentDestinations = useCallback(() => {
    if (!rideDispatchService.isEnabled) { customerRideHistorySnapshot = []; setRecentRides([]); return; }
    void rideDispatchService.getCustomerRideHistory().then((rides) => { customerRideHistorySnapshot = rides; setRecentRides(rides); }).catch(() => undefined);
  }, []);
  useFocusEffect(refreshRecentDestinations);
  const refreshSavedAddresses = useCallback(() => { void customerSavedAddressesService.list().then(setSavedAddresses).catch(() => setSavedAddresses([])); }, []);
  useFocusEffect(refreshSavedAddresses);

  const recentDestinations = useMemo(() => {
    const seen = new Set<string>();
    return recentRides.filter((ride) => {
      if (ride.status !== 'completed' || ride.drop_latitude == null || ride.drop_longitude == null || !ride.drop_address.trim()) return false;
      const key = `${ride.drop_address.trim().toLocaleLowerCase()}|${Number(ride.drop_latitude).toFixed(5)}|${Number(ride.drop_longitude).toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 3);
  }, [recentRides]);

  const recenterMap = useCallback((coordinate: Coordinate, duration: number) => {
    if (!mapRef.current) return;
    const latitudeDelta = HOME_LOCATION_DELTA;
    const longitudeDelta = HOME_LOCATION_DELTA;
    if (!mapViewportHeight) {
      mapRef.current.animateToRegion({ ...coordinate, latitudeDelta, longitudeDelta }, duration);
      return;
    }
    const sheetTop = Math.max(0, mapViewportHeight - tabBarHeight - sheetHeight + sheetPosition);
    const visibleHeight = Math.max(1, Math.min(mapViewportHeight || windowHeight, sheetTop));
    centerCoordinateInVisibleViewport(mapRef.current, coordinate, { mapHeight: mapViewportHeight || windowHeight, visibleHeight, delta: latitudeDelta, duration });
  }, [mapViewportHeight, sheetHeight, sheetPosition, tabBarHeight, windowHeight]);

  useEffect(() => {
    if (!mapReady || !mapViewportHeight || !pendingInitialRecenter.current || initialHomeCameraApplied.current) return;
    const coordinate = pendingInitialRecenter.current;
    // MapView can acknowledge readiness before its first measured render. Run
    // after that layout so the closer home zoom is not dropped by Google Maps.
    const frame = requestAnimationFrame(() => {
      recenterMap(coordinate, 0);
      initialHomeCameraApplied.current = true;
    });
    pendingInitialRecenter.current = null;
    return () => cancelAnimationFrame(frame);
  }, [mapReady, mapViewportHeight, recenterMap]);

  const setSheet = (expanded: boolean) => {
    setSheetExpanded(expanded);
    setSheetPosition(expanded ? 0 : collapsedOffset);
    sheetOffset.value = withSpring(expanded ? 0 : collapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
  };

  const sheetAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetOffset.value }] }));
  const mapRecenterFloatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetOffset.value }] }));
  const sheetScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => { sheetScrollOffset.value = Math.max(0, event.contentOffset.y); },
  });
  const sheetScrollGesture = useMemo(() => Gesture.Native(), []);
  const sheetPanGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .onBegin(() => {
      sheetCanDrag.value = sheetScrollOffset.value <= 1;
      sheetDragStart.value = sheetOffset.value;
    })
    .onUpdate((event) => {
      if (!sheetCanDrag.value) return;
      sheetOffset.value = clamp(sheetDragStart.value + event.translationY, 0, collapsedOffset);
    })
    .onEnd((event) => {
      if (!sheetCanDrag.value) return;
      const expand = event.velocityY < -350 || (event.velocityY <= 350 && sheetOffset.value < collapsedOffset / 2);
      sheetOffset.value = withSpring(expand ? 0 : collapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
      runOnJS(setSheetExpanded)(expand);
      runOnJS(setSheetPosition)(expand ? 0 : collapsedOffset);
    }), [collapsedOffset, sheetCanDrag, sheetDragStart, sheetOffset, sheetScrollOffset]);

  const landmarks = [
    { icon: '🚌', label: t('home.landmarkBusStand'), place: offlineLocationCatalogue.find((place) => place.id === 'bus-stand') },
    { icon: '🚉', label: t('home.landmarkRailway'), place: offlineLocationCatalogue.find((place) => place.id === 'railway-station') },
    { icon: '✚', label: t('home.landmarkHospital'), place: offlineLocationCatalogue.find((place) => place.id === 'government-general-hospital') },
  ];

  const handlePickLocation = (target: LocationTarget) => { onPickLocation(target); };

  const startBooking = async () => {
    // An active ride remains available through Bookings; never start a second
    // selection flow while its cancellation/dispatch state is still open.
    if (hasActiveRide) { onBookings(); return; }
    handlePickLocation('pickup');
  };
  const centerOnLocation = async () => {
    try {
      const coordinate = coordinateFromPosition(await getCustomerGpsPosition());
      setUserLocation(coordinate);
      setLocationUnavailable(false);
      setPickupMarkerReset((token) => token + 1);
      recenterMap(coordinate, 350);
      void reverseGeocodeAddress(coordinate, t('location.gpsDefault')).then(setCachedAddress);
    } catch { setLocationUnavailable(true); }
  };
  const pickupHere = async (coordinate: Coordinate) => {
    if (hasActiveRide) { onBookings(); return; }
    onPickupHere(await reverseGeocodeAddress(coordinate, t('location.gpsDefault')), coordinate);
  };
  return (
    <SafeAreaView style={styles.mapHomeSafe} edges={['top', 'left', 'right']} onLayout={(event) => setMapViewportHeight(event.nativeEvent.layout.height)}>
      <LiveLocationMap mapRef={mapRef} location={userLocation} onMapReady={() => setMapReady(true)} pickupHereLabel={t('home.pickupHere')} onPickupHere={userLocation ? pickupHere : undefined} locationResetToken={pickupMarkerReset} />

      {!mapReady && <View style={styles.mapFallback}><Text style={styles.mapFallbackText}>{t('home.mapLoading')}</Text></View>}
      {locationUnavailable && <View style={styles.locationNotice}><Text style={styles.locationNoticeText}>{t('home.locationUnavailable')}</Text></View>}

      <Reanimated.View style={[styles.homeSheet, { bottom: tabBarHeight, height: sheetHeight }, sheetAnimatedStyle, shadows.card, styles.homeSheetLayer]}>
        <GestureDetector gesture={Gesture.Simultaneous(sheetPanGesture, sheetScrollGesture)}>
          <View collapsable={false} style={styles.homeSheetGestureArea}>
            <Pressable onPress={() => { selectionHaptic(); setSheet(!sheetExpanded); }} style={styles.sheetHandleArea} accessibilityRole="button" accessibilityLabel={t('home.toggleSheet')}>
              <View style={styles.homeSheetHandle} />
            </Pressable>
            <Reanimated.ScrollView contentContainerStyle={styles.homeSheetContent} onScroll={sheetScrollHandler} scrollEventThrottle={16} showsVerticalScrollIndicator={false} style={styles.homeSheetScroll}>
              <View style={styles.homeSheetDynamicContent}>
                <Pressable onPress={() => { selectionHaptic(); startBooking(); }} accessibilityRole="button" style={styles.destinationAction}>
                  <View style={styles.destinationTextWrap}><Text style={styles.destinationLabel}>{t('home.whereTo')}</Text><Text style={styles.destinationSub}>{t('home.whereToHint')}</Text></View>
                </Pressable>
                <PromotionOfferCard promotion={promotion} t={t} strip />
                <View style={styles.recentDestinations}><Text style={styles.homeSectionTitle}>{t('home.recentDestinations')}</Text>{recentDestinations.length ? recentDestinations.map((recent) => { const coordinate = { latitude: Number(recent.drop_latitude), longitude: Number(recent.drop_longitude) }; const saved = savedAddresses.some((item) => Math.abs(item.latitude - coordinate.latitude) < 0.0001 && Math.abs(item.longitude - coordinate.longitude) < 0.0001); return <RecentDestination key={recent.id} ride={recent} saved={saved} onPress={() => { selectionHaptic(); const pickup = userLocation ? (cachedAddress || t('location.gpsDefault')) : undefined; onChooseDestination(recent.drop_address, coordinate, pickup, userLocation ?? undefined); }} onSave={() => onSaveDestination(recent.drop_address, coordinate)} />; }) : <Text style={styles.recentDestinationsEmpty}>{t('home.recentDestinationsEmpty')}</Text>}</View>
                <View style={styles.homeExpandedOnly}>
                  <View style={styles.sectionHeading}><Text style={styles.homeSectionTitle}>{t('home.nearby')}</Text><Text style={styles.homeSectionLink} onPress={() => { selectionHaptic(); handlePickLocation('drop'); }}>{t('home.seeAll')}</Text></View>
                  <View style={styles.landmarkRow}>{landmarks.map((landmark) => <Pressable key={landmark.label} accessibilityRole="button" onPress={() => { if (!landmark.place?.coordinate) return; selectionHaptic(); onChooseDestination(landmark.label, landmark.place.coordinate); }} style={styles.landmarkCard}><Text style={styles.landmarkIcon}>{landmark.icon}</Text><Text style={styles.landmarkText} numberOfLines={2}>{landmark.label}</Text></Pressable>)}</View>
                </View>
              </View>
              <View pointerEvents="none" style={styles.homeSheetBrandWallpaper}>
                <Image accessibilityIgnoresInvertColors resizeMode="cover" source={sawaariHomeFooter} style={styles.homeSheetBrandArtwork} />
              </View>
            </Reanimated.ScrollView>
          </View>
        </GestureDetector>
      </Reanimated.View>
      <Reanimated.View style={[styles.mapRecenterButton, { bottom: sheetHeight + tabBarHeight + 12 }, mapRecenterFloatStyle]}>
        <MapGpsButton accessibilityLabel={t('home.recenter')} onPress={() => { selectionHaptic(); void centerOnLocation(); }} />
      </Reanimated.View>
      <CustomerTabBar active="home" onHome={() => undefined} onBookings={onBookings} onProfile={onProfile} />
      {ratingPrompt && <CaptainRatingSheet rideId={ratingPrompt.rideId} captainName={ratingPrompt.captainName} onDismiss={onDismissRating} onSkip={onSkipRating} />}
    </SafeAreaView>
  );
}

function CaptainRatingSheet({ rideId, captainName, onDismiss, onSkip }: { rideId: string; captainName: string; onDismiss: () => void; onSkip: (rideId: string) => Promise<void> }) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const [rating, setRating] = useState(0);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!rating) { setError(t('rides.ratingRequired')); return; }
    setSaving(true); setError('');
    try { await rideDispatchService.rateCaptain(rideId, rating); onDismiss(); }
    catch { setError(t('rides.ratingSaveFailed')); }
    finally { setSaving(false); }
  };
  const skip = async () => {
    setSkipping(true); setError('');
    try { await onSkip(rideId); onDismiss(); }
    catch { setError(t('rides.ratingSaveFailed')); }
    finally { setSkipping(false); }
  };
  return <Modal transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { void skip(); }}><View style={styles.ratingOverlay}>
    <View style={[styles.ratingSheet, { paddingBottom: Math.max(32, bottom + 20) }]}>
      <View style={styles.modalSheetHandle} /><Pressable accessibilityRole="button" accessibilityLabel="Close rating" disabled={saving || skipping} hitSlop={12} onPress={() => { void skip(); }} style={styles.ratingClose}><Text style={styles.ratingCloseText}>×</Text></Pressable>
      <Text style={styles.ratingTitle}>{t('rides.rateCaptainTitle')}</Text><Text style={styles.ratingSubtitle}>{t('rides.rateCaptainSubtitle', { captain: captainName })}</Text>
      <View accessibilityRole="radiogroup" style={styles.ratingStars}>{[1, 2, 3, 4, 5].map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: rating === value }} onPress={() => { selectionHaptic(); setRating(value); setError(''); }} hitSlop={6}><Text style={[styles.ratingStar, value <= rating && styles.ratingStarSelected]}>★</Text></Pressable>)}</View>
      {!!error && <Text style={styles.ratingError}>{error}</Text>}<PrimaryButton label={saving ? t('login.pleaseWait') : t('rides.submitRating')} onPress={() => { void submit(); }} disabled={saving || skipping} /><Pressable accessibilityRole="button" disabled={saving || skipping} onPress={() => { void skip(); }} style={styles.ratingSkip}><Text style={styles.ratingSkipText}>{skipping ? t('login.pleaseWait') : t('rides.skipRating')}</Text></Pressable>
    </View>
  </View></Modal>;
}

function RecentDestination({ ride, saved, onPress, onSave }: { ride: DispatchRide; saved: boolean; onPress: () => void; onSave: () => void }) {
  const [name, ...address] = ride.drop_address.split(',').map((part) => part.trim()).filter(Boolean);
  return <View style={styles.recentDestination}><Pressable accessibilityRole="button" onPress={onPress} style={styles.recentDestinationMain}><Text style={styles.recentDestinationIcon}>↺</Text><View style={styles.recentDestinationText}><Text style={styles.recentDestinationName} numberOfLines={1}>{name || ride.drop_address}</Text>{address.length > 0 && <Text style={styles.recentDestinationAddress} numberOfLines={2}>{address.join(', ')}</Text>}</View></Pressable><Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Saved address' : 'Save address'} onPress={() => { selectionHaptic(); onSave(); }} hitSlop={10} style={styles.recentBookmark}><Text style={[styles.recentBookmarkText, saved && styles.recentBookmarkSaved]}>{saved ? '♥' : '♡'}</Text></Pressable></View>;
}

type CustomerTabIconKind = 'home' | 'rides' | 'account';

function CustomerTabIcon({ kind, active = false }: { kind: CustomerTabIconKind; active?: boolean }) {
  const color = active ? colors.primary : colors.textMuted;
  const props = { color, size: 25, strokeWidth: active ? 2.4 : 2 };
  if (kind === 'home') return <House {...props} />;
  if (kind === 'rides') return <CalendarClock {...props} />;
  return <CircleUserRound {...props} />;
}

function HomeTab({ kind, label, active, onPress }: { kind: CustomerTabIconKind; label: string; active?: boolean; onPress?: () => void }) {
  return <Pressable disabled={!onPress} onPress={() => { if (onPress) { selectionHaptic(); onPress(); } }} accessibilityRole="button" accessibilityState={{ selected: active }} style={styles.homeTab}><CustomerTabIcon kind={kind} active={active} /><Text style={[styles.homeTabLabel, active && styles.homeTabLabelActive]} numberOfLines={1}>{label}</Text></Pressable>;
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
  const { t, i18n } = useTranslation();
  const [drafts, setDrafts] = useState<Record<LocationTarget, string>>({ pickup: ride.pickup, drop: ride.drop });
  const [target, setTarget] = useState<LocationTarget>(initialTarget);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [cataloguePin, setCataloguePin] = useState<OfflineLocation | null>(null);
  const [resolution, setResolution] = useState<Record<LocationTarget, 'unresolved' | 'located' | 'failed'>>({
    pickup: ride.pickupCoordinate ? 'located' : 'unresolved',
    drop: ride.dropCoordinate ? 'located' : 'unresolved',
  });
  const [focused, setFocused] = useState(false);
  const [editingTarget, setEditingTarget] = useState<LocationTarget | null>(null);
  const [liveSuggestions, setLiveSuggestions] = useState<PlaceSuggestion[]>([]);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const [suggestionRouteDistances, setSuggestionRouteDistances] = useState<Record<string, number>>({});
  const placesSessionToken = useRef(newPlacesSessionToken());
  const autocompleteSeq = useRef(0);
  const locationUpdateSeq = useRef<Record<LocationTarget, number>>({ pickup: 0, drop: 0 });
  const pickupInput = useRef<TextInput>(null);
  const dropInput = useRef<TextInput>(null);
  const query = drafts[target];
  const ready = resolution.pickup === 'located' && resolution.drop === 'located';
  // A resolved field already represents the customer's selection. Keep its
  // address visible, but do not treat that programmatic value as new input and
  // show the same (or another) autocomplete row beneath it.
  const isEditingUnresolvedAddress = resolution[target] === 'unresolved';
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const queryTerms = normalizedQuery.split(/\s+/).filter(Boolean);
  // Start suggesting after three characters, not three complete words. Every
  // typed term still has to match the catalogue label, in any order.
  const hasCatalogueQuery = normalizedQuery.length >= 3;
  const showLiveResults = hasCatalogueQuery && liveSuggestions.length > 0;
  const shown = hasCatalogueQuery
    ? offlineLocationCatalogue.filter((place) => {
      const label = (place.labelKey ? t(`location.${place.labelKey}`) : place.label).toLocaleLowerCase();
      return queryTerms.every((term) => label.includes(term));
    })
    : [];
  const pickupForSuggestionRoutes = target === 'drop' && resolution.pickup === 'located' ? ride.pickupCoordinate : undefined;
  const suggestionRouteCandidates: RouteDistanceCandidate[] = (showLiveResults
    ? liveSuggestions.map((suggestion) => ({ id: `place:${suggestion.placeId}`, placeId: suggestion.placeId }))
    : shown.filter((place) => Boolean(place.coordinate)).map((place) => ({ id: `offline:${place.id}`, coordinate: place.coordinate! })))
    .slice(0, 5);
  const suggestionRouteCandidateKey = suggestionRouteCandidates.map((candidate) => `${candidate.id}:${candidate.placeId ?? `${candidate.coordinate?.latitude},${candidate.coordinate?.longitude}`}`).join('|');

  useEffect(() => {
    // Recent destinations arrive with both addresses already resolved. Do not
    // focus a native TextInput in that case: Android scrolls a prefilled input
    // to the end, hiding the useful beginning of the address.
    if (resolution.pickup === 'located' && resolution.drop === 'located') return;
    setEditingTarget(initialTarget);
    requestAnimationFrame(() => (initialTarget === 'pickup' ? pickupInput : dropInput).current?.focus());
  }, [initialTarget]);

  const setDraft = (nextTarget: LocationTarget, value: string) => {
    locationUpdateSeq.current[nextTarget] += 1;
    setTarget(nextTarget);
    setEditingTarget(nextTarget);
    setDrafts((current) => ({ ...current, [nextTarget]: value }));
    setResolution((current) => ({ ...current, [nextTarget]: 'unresolved' }));
    // Text alone must never retain a previous pin or route quote.
    onChange(nextTarget, value, undefined);
  };

  const choosePlace = (place: string, coordinate?: Coordinate, placeTarget: LocationTarget = target) => {
    locationUpdateSeq.current[placeTarget] += 1;
    if (!coordinate) {
      setResolution((current) => ({ ...current, [placeTarget]: 'failed' }));
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDrafts((current) => ({ ...current, [placeTarget]: place }));
    setResolution((current) => ({ ...current, [placeTarget]: 'located' }));
    onChange(placeTarget, place, coordinate);
    const nextTarget: LocationTarget = placeTarget === 'pickup' ? 'drop' : 'pickup';
    if (resolution[nextTarget] !== 'located') {
      setTarget(nextTarget);
      setEditingTarget(nextTarget);
      requestAnimationFrame(() => (nextTarget === 'pickup' ? pickupInput : dropInput).current?.focus());
    } else {
      // Both places are resolved. Leaving a TextInput focused keeps Android's
      // keyboard on screen and makes the completed form look editable again.
      // Close it so the customer can immediately use the ride-options action.
      setFocused(false);
      setEditingTarget(null);
      pickupInput.current?.blur();
      dropInput.current?.blur();
      Keyboard.dismiss();
    }
  };

  const resolveTypedAddress = () => {
    if (liveSuggestions.length > 0) {
      void selectSuggestion(liveSuggestions[0]);
      return;
    }
    if (!hasCatalogueQuery || shown.length === 0) {
      setResolution((current) => ({ ...current, [target]: 'failed' }));
    }
  };

  const selectSuggestion = async (suggestion: PlaceSuggestion) => {
    const selectedTarget = target;
    setLiveSuggestions([]);
    setLiveStatus('idle');
    const sessionToken = placesSessionToken.current;
    placesSessionToken.current = newPlacesSessionToken();
    try {
      const details = await googleMapsService.placeDetails(suggestion.placeId, sessionToken);
      choosePlace(suggestion.text || details.address, details.coordinate, selectedTarget);
    } catch (error) {
      console.warn('[place-details] lookup failed', error);
      setResolution((current) => ({ ...current, [selectedTarget]: 'failed' }));
    }
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!isEditingUnresolvedAddress || trimmed.length < 3) {
      autocompleteSeq.current += 1;
      setLiveSuggestions([]);
      setLiveStatus('idle');
      return;
    }
    const seq = ++autocompleteSeq.current;
    const timer = setTimeout(() => {
      setLiveStatus('loading');
      googleMapsService.autocomplete(trimmed, placesSessionToken.current, i18n.language)
        .then((results) => {
          if (autocompleteSeq.current !== seq) return;
          setLiveSuggestions(results);
          setLiveStatus('ready');
        })
        .catch((error) => {
          console.warn('[places-autocomplete] request failed', error);
          if (autocompleteSeq.current !== seq) return;
          setLiveSuggestions([]);
          setLiveStatus('unavailable');
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [isEditingUnresolvedAddress, query, target]);

  useEffect(() => {
    // These are actual DRIVING distances, not a map-radius approximation.
    // Wait for the query to settle so typing does not create a route request
    // for every keystroke, and ignore an obsolete response after new results.
    if (!pickupForSuggestionRoutes || !suggestionRouteCandidates.length) { setSuggestionRouteDistances({}); return; }
    let active = true;
    const timer = setTimeout(() => {
      void googleMapsService.suggestionRouteDistances(pickupForSuggestionRoutes, suggestionRouteCandidates)
        .then((distances) => {
          if (!active) return;
          setSuggestionRouteDistances(Object.fromEntries(distances.map((distance) => [distance.id, distance.distanceMeters])));
        })
        .catch(() => { if (active) setSuggestionRouteDistances({}); });
    }, 650);
    return () => { active = false; clearTimeout(timer); };
  }, [pickupForSuggestionRoutes?.latitude, pickupForSuggestionRoutes?.longitude, suggestionRouteCandidateKey]);

  const renderSuggestions = () => {
    if (!focused || !isEditingUnresolvedAddress || !hasCatalogueQuery) return null;
    if (liveSuggestions.length === 0 && shown.length === 0) return null;
    const liveRows = liveSuggestions.map((suggestion, i) => (
      <Pressable key={suggestion.placeId} onPress={() => void selectSuggestion(suggestion)} style={[styles.resultRow, i < liveSuggestions.length - 1 && styles.resultRowDivider]}>
        <SuggestionMarker distanceMeters={suggestionRouteDistances[`place:${suggestion.placeId}`]} /><Text style={styles.resultText} numberOfLines={2}>{suggestion.text}</Text>
      </Pressable>
    ));
    const catalogueRows = shown.map((place, i) => {
      const label = place.labelKey ? t(`location.${place.labelKey}`) : place.label;
      return (
        <Pressable key={place.id} onPress={() => { setCataloguePin(place); setPinMode(true); }} style={[styles.resultRow, i < shown.length - 1 && styles.resultRowDivider]}>
          <SuggestionMarker distanceMeters={suggestionRouteDistances[`offline:${place.id}`]} /><Text style={styles.resultText} numberOfLines={2}>{label}</Text>
        </Pressable>
      );
    });
    return (
      <View>
        {(showLiveResults || shown.length > 0) && <View style={[styles.resultsCard, shadows.soft]}>
          <ScrollView style={styles.resultsScroll} keyboardShouldPersistTaps="handled">
            {showLiveResults ? liveRows : catalogueRows}
          </ScrollView>
        </View>}
        {liveStatus === 'unavailable' && shown.length > 0 && <Text style={styles.locationResolution}>{t('location.placesUnavailable')}</Text>}
      </View>
    );
  };

  const useGps = async () => {
    if (gpsLoading) return;
    setGpsLoading(true);
    const selectedTarget = target;
    try {
      const coordinate = coordinateFromPosition(await getCustomerGpsPosition());
      choosePlace(t('location.gpsDefault'), coordinate, selectedTarget);
      const updateSeq = locationUpdateSeq.current[selectedTarget];
      void reverseGeocodeAddress(coordinate, t('location.gpsDefault')).then((address) => {
        if (locationUpdateSeq.current[selectedTarget] !== updateSeq) return;
        setDrafts((current) => ({ ...current, [selectedTarget]: address }));
        onChange(selectedTarget, address, coordinate);
      });
    } catch {
      setResolution((current) => ({ ...current, [selectedTarget]: 'failed' }));
    } finally {
      setGpsLoading(false);
    }
  };

  if (pinMode) {
    return <PinDropPicker
      target={target}
      initialCoordinate={cataloguePin ? cataloguePin.coordinate : (target === 'pickup' ? ride.pickupCoordinate : ride.dropCoordinate)}
      initialAddress={cataloguePin ? (cataloguePin.labelKey ? t(`location.${cataloguePin.labelKey}`) : cataloguePin.label) : undefined}
      requiresManualPin={Boolean(cataloguePin && !cataloguePin.coordinate)}
      onBack={() => { setCataloguePin(null); setPinMode(false); }}
      onConfirm={(address, coordinate) => { choosePlace(address, coordinate); setCataloguePin(null); setPinMode(false); }}
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
          editing={editingTarget === 'pickup'}
          showCaret={editingTarget === null && target === 'pickup' && Boolean(drafts.pickup)}
          onActivate={() => { setTarget('pickup'); setFocused(true); setEditingTarget('pickup'); requestAnimationFrame(() => pickupInput.current?.focus()); }}
          onFocus={() => { setTarget('pickup'); setFocused(true); setEditingTarget('pickup'); }}
            onBlur={() => setFocused(false)}
            onChangeText={(value) => setDraft('pickup', value)}
            onSubmitEditing={() => void resolveTypedAddress()}
          />
          {target === 'pickup' && renderSuggestions()}
          <View style={styles.locationFieldDivider} />
          <LocationField
            inputRef={dropInput}
            active={target === 'drop'}
            icon="●"
            label={t('location.destinationField')}
            value={drafts.drop}
            placeholder={t('home.drop')}
          editing={editingTarget === 'drop'}
          showCaret={editingTarget === null && target === 'drop' && Boolean(drafts.drop)}
          onActivate={() => { setTarget('drop'); setFocused(true); setEditingTarget('drop'); requestAnimationFrame(() => dropInput.current?.focus()); }}
          onFocus={() => { setTarget('drop'); setFocused(true); setEditingTarget('drop'); }}
            onBlur={() => setFocused(false)}
            onChangeText={(value) => setDraft('drop', value)}
            onSubmitEditing={() => void resolveTypedAddress()}
            drop
          />
          {target === 'drop' && renderSuggestions()}
        </View>
        <View style={styles.locationQuickActions}>
          <Pressable onPress={useGps} disabled={gpsLoading} accessibilityRole="button" style={styles.locationQuickAction}><Text style={styles.locationQuickActionText} numberOfLines={1}>{gpsLoading ? t('location.gpsLoading') : t('location.gps')}</Text></Pressable>
          <Pressable onPress={() => setPinMode(true)} accessibilityRole="button" style={styles.locationQuickAction}><Text style={styles.locationQuickActionText} numberOfLines={1}>{t('location.dropPin')}</Text></Pressable>
        </View>
        {resolution[target] === 'failed' && <Text style={[styles.locationResolution, styles.locationResolutionFailed]}>{t('location.addressNotLocated')}</Text>}
        <PrimaryButton label={t('location.showRideOptions')} onPress={onContinue} disabled={!ready} />
      </>
    </ScreenShell>
  );
}

function SuggestionMarker({ distanceMeters }: { distanceMeters?: number }) {
  return <View accessibilityLabel={distanceMeters ? `${formatRoadDistance(distanceMeters)} by road from pickup` : undefined} style={styles.resultMarker}><Text style={styles.resultPin}>📍</Text>{distanceMeters && <Text style={styles.resultDistance}>{formatRoadDistance(distanceMeters)}</Text>}</View>;
}

function LocationField({ inputRef, active, editing, showCaret, icon, label, value, placeholder, onActivate, onFocus, onBlur, onChangeText, onSubmitEditing, drop }: {
  inputRef: React.RefObject<TextInput | null>; active: boolean; editing: boolean; showCaret: boolean; icon: string; label: string; value: string; placeholder: string; onActivate: () => void; onFocus: () => void; onBlur: () => void; onChangeText: (value: string) => void; onSubmitEditing: () => void; drop?: boolean;
}) {
  const preview = Boolean(value) && !editing;
  return <View style={[styles.locationField, active && styles.locationFieldActive]}><View style={[styles.locationFieldDot, drop && styles.locationFieldDotDrop]}><Text style={[styles.locationFieldDotText, drop && styles.locationFieldDotTextDrop]}>{icon}</Text></View><View style={styles.locationFieldTextWrap}><Text style={styles.locationFieldLabel}>{label}</Text>{preview ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onActivate} style={styles.locationFieldPreview}><Text numberOfLines={1} ellipsizeMode="tail" style={styles.locationFieldPreviewText}>{value}</Text>{showCaret && <LocationFieldCaret />}</Pressable> : <TextInput ref={inputRef} value={value} onFocus={onFocus} onBlur={onBlur} onChangeText={onChangeText} onSubmitEditing={onSubmitEditing} placeholder={placeholder} placeholderTextColor={colors.textMuted} style={styles.locationFieldInput} returnKeyType="done" />}</View></View>;
}

function LocationFieldCaret() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: 0.2, duration: 520, useNativeDriver: true }), Animated.timing(opacity, { toValue: 1, duration: 520, useNativeDriver: true })]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.View style={[styles.locationFieldCaret, { opacity }]} />;
}

function PinDropPicker({ target, initialCoordinate, initialAddress, requiresManualPin, onBack, onConfirm }: { target: LocationTarget; initialCoordinate?: Coordinate; initialAddress?: string; requiresManualPin?: boolean; onBack: () => void; onConfirm: (address: string, coordinate: Coordinate) => void }) {
  const { t } = useTranslation();
  const { bottomInset } = useBottomTabBarMetrics();
  const mapRef = useRef<MapView>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coordinate = initialCoordinate ?? { latitude: NANDYAL.latitude, longitude: NANDYAL.longitude };
  const [selectedCoordinate, setSelectedCoordinate] = useState<Coordinate>(coordinate);
  const [address, setAddress] = useState(initialAddress ?? t('location.resolvingAddress'));
  const lastResolvedCoordinate = useRef<Coordinate | null>(null);
  const skipInitialRegionResolution = useRef(Boolean(initialAddress) || requiresManualPin);
  const [hasPlacedPin, setHasPlacedPin] = useState(!requiresManualPin);
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const resolveAddress = (next: Coordinate) => {
    if (timer.current) clearTimeout(timer.current);
    const previous = lastResolvedCoordinate.current;
    // A pin can emit many region updates while the user pans. Only resolve
    // once it has moved roughly 25 m from the last address lookup.
    if (previous && straightLineDistanceMeters(previous, next) < 25) return;
    setAddress(t('location.resolvingAddress'));
    timer.current = setTimeout(() => {
      lastResolvedCoordinate.current = next;
      reverseGeocodeAddress(next, t('location.pinAddressFallback')).then(setAddress);
    }, 1200);
  };

  useEffect(() => {
    if (!initialAddress && !requiresManualPin) resolveAddress(coordinate);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, []);

  const centerOnCurrentLocation = async () => {
    if (gpsLoading) return;
    setGpsLoading(true);
    try {
      const next = coordinateFromPosition(await getCustomerGpsPosition());
      setUserLocation(next);
      setSelectedCoordinate(next);
      setHasPlacedPin(true);
      mapRef.current?.animateToRegion({ ...next, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 350);
      resolveAddress(next);
    } catch {
      // The shared GPS helper has already requested permission; leave the pin in place if it is unavailable.
    } finally {
      setGpsLoading(false);
    }
  };

  return <SafeAreaView style={styles.pinPickerSafe} edges={['top', 'left', 'right']}>
    <MapView
      ref={mapRef}
      provider={mapProvider}
      initialRegion={{ ...coordinate, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
      onRegionChangeComplete={(region) => {
        const next = { latitude: region.latitude, longitude: region.longitude };
        setSelectedCoordinate(next);
        if (skipInitialRegionResolution.current) {
          skipInitialRegionResolution.current = false;
          return;
        }
        setHasPlacedPin(true);
        resolveAddress(next);
      }}
      style={StyleSheet.absoluteFill}
    >
      {userLocation && <LiveLocationMarker coordinate={userLocation} />}
    </MapView>
    <View pointerEvents="none" style={styles.fixedPinWrap}><View style={styles.fixedPin}><Text style={styles.fixedPinText}>●</Text></View><View style={styles.fixedPinStem} /></View>
    <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={onBack} style={[styles.pinPickerBack, shadows.card]}><Text style={styles.pinPickerBackText}>‹</Text></Pressable>
    <View style={styles.pinPickerGps}><MapGpsButton accessibilityLabel={t('home.recenter')} disabled={gpsLoading} onPress={() => { void centerOnCurrentLocation(); }} /></View>
    <View style={[styles.pinPickerSheet, { paddingBottom: 24 + bottomInset }, shadows.card]}>
      <View style={styles.sheetHandle} />
      <Text style={styles.pinPickerTitle}>{t(target === 'pickup' ? 'location.selectPickup' : 'location.selectDrop')}</Text>
      <View style={styles.pinAddressCard}><Text style={styles.pinAddressIcon}>●</Text><Text style={styles.pinAddressText} numberOfLines={3}>{address}</Text></View>
      {requiresManualPin && <Text style={styles.pinPickerHint}>Move the map to place the exact pin for this location.</Text>}
      <PrimaryButton label={t(target === 'pickup' ? 'location.confirmPickup' : 'location.confirmDrop')} onPress={() => onConfirm(address, selectedCoordinate)} disabled={!hasPlacedPin} />
    </View>
  </SafeAreaView>;
}

async function reverseGeocodeAddress(coordinate: Coordinate, fallback: string) {
  try {
    const { address } = await googleMapsService.reverseGeocode(coordinate);
    if (address) return address;
  } catch {
    // Fall through to Expo's local provider without exposing a server key.
  }
  try {
    const [place] = await Location.reverseGeocodeAsync(coordinate);
    if (!place) return fallback;
    // `name` is often the nearest POI rather than the address at the GPS
    // coordinate, so do not let it replace a customer's street/home label.
    const lineOne = [place.streetNumber, place.street].filter(Boolean).join(', ');
    const lineTwo = [place.district, place.city, place.region].filter(Boolean).join(', ');
    return [lineOne, lineTwo].filter(Boolean).join(', ') || fallback;
  } catch { return fallback; }
}

/* ─────────────────────────── RIDE TYPE ─────────────────────────── */

export function RideTypeScreen({
  ride,
  selected,
  onSelect,
  onPassengerCountChange,
  onPaymentPreferenceChange,
  onRouteQuote,
  onNext,
  onBack,
  onEditLocation,
  onInvalidRoute,
  unavailableMessage,
  onUnavailableMessageHidden,
}: {
  ride: CustomerRide;
  selected: RideKind;
  onSelect: (kind: RideKind) => void;
  onPassengerCountChange: (count: number) => void;
  onPaymentPreferenceChange: (preference: PaymentPreference, upiApp?: UpiApp) => void;
  onRouteQuote: (quote: RouteQuote) => void;
  onNext: (ride: CustomerRide) => void;
  onBack: () => void;
  onEditLocation: (target: LocationTarget) => void;
  onInvalidRoute: (target: LocationTarget) => void;
  unavailableMessage?: string;
  onUnavailableMessageHidden: () => void;
}) {
  const { t } = useTranslation();
  const { bottomInset } = useBottomTabBarMetrics();
  const { height: windowHeight } = useWindowDimensions();
  // Keep both vehicle choices readable before asking the customer to drag the
  // sheet. The old fixed 27% peek hid part of the second card on compact
  // Android displays (and when Display size was enlarged).
  const fixedActionsHeight = 132;
  const rideSheetHeight = Math.min(500, Math.max(300, windowHeight - bottomInset - fixedActionsHeight - 64));
  const collapsedVisibleHeight = Math.min(rideSheetHeight, Math.max(244, Math.min(292, Math.round(windowHeight * 0.38))));
  const rideSheetCollapsedOffset = Math.max(0, rideSheetHeight - collapsedVisibleHeight);
  const rideSheetOffset = useSharedValue(rideSheetCollapsedOffset);
  const rideSheetDragStart = useSharedValue(rideSheetCollapsedOffset);
  const rideSheetScrollOffset = useSharedValue(0);
  const rideSheetCanDrag = useSharedValue(true);
  const [rideSheetExpanded, setRideSheetExpanded] = useState(false);
  const [paymentPickerOpen, setPaymentPickerOpen] = useState(false);
  const [offersOpen, setOffersOpen] = useState(false);
  const mapRef = useRef<MapView>(null);
  const pickupCoordinate = ride.pickupCoordinate ?? locationCoordinate(ride.pickup, 0);
  const dropCoordinate = ride.dropCoordinate ?? locationCoordinate(ride.drop, 1);
  const [routeQuote, setRouteQuote] = useState<RouteQuote | undefined>(ride.routeQuote);
  const [routeLoading, setRouteLoading] = useState(!hasUsableRouteQuote(ride.routeQuote));
  const [routeError, setRouteError] = useState<string | null>(null);
  const missingLocation = missingCustomerBookingLocation(ride);
  const encodedPolyline = typeof routeQuote?.encodedPolyline === 'string' ? routeQuote.encodedPolyline : '';
  const routeCoordinates = decodeGooglePolyline(encodedPolyline);
  const hasValidRouteQuote = hasUsableRouteQuote(routeQuote);

  useEffect(() => {
    if (missingLocation) onInvalidRoute(missingLocation);
  }, [missingLocation, onInvalidRoute]);
  useEffect(() => {
    let active = true;
    if (hasUsableRouteQuote(ride.routeQuote)) { setRouteQuote(ride.routeQuote); setRouteError(null); setRouteLoading(false); return; }
    setRouteQuote(undefined);
    setRouteLoading(true);
    setRouteError(null);
    googleMapsService.previewTripRoute(pickupCoordinate, dropCoordinate)
      .then((quote) => { if (__DEV__) console.log('[route-preview] quote', { id: quote.id, encodedChars: quote.encodedPolyline.length }); if (active) { setRouteQuote(quote); onRouteQuote(quote); } })
      .catch((error) => { if (__DEV__) console.log('[route-preview] failed', error); if (active) { setRouteQuote(undefined); setRouteError(error instanceof Error ? error.message : 'Road route is unavailable'); } })
      .finally(() => { if (active) setRouteLoading(false); });
    return () => { active = false; };
  }, [ride.routeQuote, pickupCoordinate.latitude, pickupCoordinate.longitude, dropCoordinate.latitude, dropCoordinate.longitude, onRouteQuote]);

  useEffect(() => {
    if (routeCoordinates.length < 2) return;
    const timer = setTimeout(() => fitRouteInVisibleViewport(mapRef.current, routeCoordinates, getVisibleMapPadding({ top: 64, bottomSheetHeight: rideSheetExpanded ? rideSheetHeight : rideSheetHeight - rideSheetCollapsedOffset, bottomInset })), 100);
    return () => clearTimeout(timer);
  }, [bottomInset, rideSheetCollapsedOffset, rideSheetExpanded, rideSheetHeight, routeQuote?.id]);
  useEffect(() => {
    if (!unavailableMessage) return;
    const timer = setTimeout(onUnavailableMessageHidden, 5_000);
    return () => clearTimeout(timer);
  }, [onUnavailableMessageHidden, unavailableMessage]);
  const options: Array<{ kind: RideKind; fareDisplay: CustomerFareDisplay; eta: number }> = [
    { kind: 'bike', fareDisplay: getCustomerFareDisplay({ kind: 'bike', passengerCount: 1, routeQuote, promotion: null }), eta: 3 },
    { kind: 'auto', fareDisplay: getCustomerFareDisplay({ kind: 'auto', passengerCount: ride.passengerCount, routeQuote, promotion: null }), eta: 5 },
  ];
  const setRideSheet = (expanded: boolean) => {
    setRideSheetExpanded(expanded);
    rideSheetOffset.value = withSpring(expanded ? 0 : rideSheetCollapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
  };
  const rideSheetAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rideSheetOffset.value }] }));
  const rideSheetScrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => { rideSheetScrollOffset.value = Math.max(0, event.contentOffset.y); },
  });
  const rideSheetScrollGesture = useMemo(() => Gesture.Native(), []);
  const rideSheetPanGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-24, 24])
    .onBegin(() => {
      rideSheetCanDrag.value = rideSheetScrollOffset.value <= 1;
      rideSheetDragStart.value = rideSheetOffset.value;
    })
    .onUpdate((event) => {
      if (!rideSheetCanDrag.value) return;
      rideSheetOffset.value = clamp(rideSheetDragStart.value + event.translationY, 0, rideSheetCollapsedOffset);
    })
    .onEnd((event) => {
      if (!rideSheetCanDrag.value) return;
      const expand = event.velocityY < -350 || (event.velocityY <= 350 && rideSheetOffset.value < rideSheetCollapsedOffset / 2);
      rideSheetOffset.value = withSpring(expand ? 0 : rideSheetCollapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
      runOnJS(setRideSheetExpanded)(expand);
    }), [rideSheetCanDrag, rideSheetCollapsedOffset, rideSheetDragStart, rideSheetOffset, rideSheetScrollOffset]);

  if (missingLocation) return <View style={styles.bookingRouteRecovery}><ActivityIndicator /></View>;

  return <SafeAreaView style={styles.rideOptionsSafe} edges={['top', 'left', 'right']}>
    <MapView ref={mapRef} provider={mapProvider} initialRegion={NANDYAL} style={StyleSheet.absoluteFill}>
      <Marker coordinate={pickupCoordinate} pinColor={colors.success} title={t('rides.pickup')} />
      <Marker coordinate={dropCoordinate} pinColor={colors.accent} title={t('rides.drop')} />
      {routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor={colors.primaryDark} strokeWidth={5} />}
    </MapView>
    <View style={styles.rideOptionsTop}>
      <Pressable onPress={onBack} accessibilityRole="button" style={[styles.rideOptionsBack, styles.rideOptionsBackFloating, shadows.soft]}><Text style={styles.rideOptionsBackText}>‹</Text></Pressable>
      <View style={[styles.routeSummary, shadows.soft]}><Pressable onPress={() => onEditLocation('pickup')} accessibilityRole="button" style={styles.routeSummaryPlace}><Text style={styles.routeSummaryDot}>●</Text><Text style={styles.routeSummaryText} numberOfLines={1}>{ride.pickup}</Text></Pressable><Text style={styles.routeSummaryArrow}>→</Text><Pressable onPress={() => onEditLocation('drop')} accessibilityRole="button" style={styles.routeSummaryPlace}><Text style={[styles.routeSummaryDot, styles.routeSummaryDropDot]}>●</Text><Text style={styles.routeSummaryText} numberOfLines={1}>{ride.drop}</Text></Pressable></View>
    </View>
    <View style={styles.rideOptionsBottom}>
      {unavailableMessage && <View style={[styles.searchUnavailableBanner, shadows.soft]}><Text style={styles.searchUnavailableBannerText}>{unavailableMessage}</Text></View>}
      <Reanimated.View style={[styles.rideOptionsSheet, { bottom: bottomInset + fixedActionsHeight, height: rideSheetHeight }, rideSheetAnimatedStyle, shadows.card]}>
        <GestureDetector gesture={Gesture.Simultaneous(rideSheetPanGesture, rideSheetScrollGesture)}>
          <View collapsable={false} style={styles.rideOptionsSheetGestureArea}>
            <Pressable onPress={() => { selectionHaptic(); setRideSheet(!rideSheetExpanded); }} style={styles.sheetHandleArea} accessibilityRole="button" accessibilityLabel={t('home.toggleSheet')}>
              <View style={styles.sheetHandle} />
            </Pressable>
            <Reanimated.ScrollView style={styles.rideOptionsSheetScroll} contentContainerStyle={styles.rideOptionsSheetContent} onScroll={rideSheetScrollHandler} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        <View style={styles.rideOptionsHeader}><Text style={styles.rideOptionsHeading}>{t('rides.selectRide')}</Text><Text style={[styles.rideFareHeading, routeError && styles.rideFareHeadingError]}>{routeLoading ? 'Finding road route…' : routeError ? t('rides.routeUnavailable') : t('rides.estimate')}</Text></View>
      <View style={styles.rideOptionList}>{options.map((option) => (
        <RideCard
          key={option.kind}
          option={option}
          selected={selected === option.kind}
          onSelect={() => onSelect(option.kind)}
          t={t}
        />
      ))}</View>
      {selected === 'auto' && <View style={styles.passengerPicker}><Text style={styles.passengerPickerLabel}>{t('rides.autoPassengers')}</Text><View style={styles.passengerChoices}>{[1, 2, 3].map((count) => <Pressable key={count} onPress={() => onPassengerCountChange(count)} accessibilityRole="button" accessibilityState={{ selected: ride.passengerCount === count }} style={[styles.passengerChoice, ride.passengerCount === count && styles.passengerChoiceSelected]}><Text style={[styles.passengerChoiceText, ride.passengerCount === count && styles.passengerChoiceTextSelected]}>{formatNumber(count)}</Text></Pressable>)}</View></View>}
            </Reanimated.ScrollView>
          </View>
        </GestureDetector>
      </Reanimated.View>
      <View style={[styles.rideOptionsFixedActions, { paddingBottom: bottomInset + 12 }, shadows.card]}>
        <View style={styles.bookingActionRow}><Pressable accessibilityRole="button" accessibilityState={{ expanded: paymentPickerOpen }} onPress={() => { selectionHaptic(); setPaymentPickerOpen(true); }} style={styles.paymentPreferenceToggle}>
          <Text style={styles.rideOptionsExtra}>₹ {ride.paymentPreference === 'upi' ? t('rides.payOnline') : t('rides.cash')}</Text>
          <Text style={styles.rideOptionsExtraChevron}>{paymentPickerOpen ? '⌃' : '⌄'}</Text>
        </Pressable><Pressable accessibilityRole="button" onPress={() => setOffersOpen(true)} style={styles.offersToggle}><Text style={styles.rideOptionsExtra}>% Offers</Text><Text style={styles.rideOptionsExtraChevron}>›</Text></Pressable></View>
        <PrimaryButton label={t('rides.bookSelected', { ride: t(`rides.${selected}`) })} onPress={() => onNext(toCustomerBookingConfirmationSnapshot({ ...ride, kind: selected }, routeQuote))} disabled={!hasValidRouteQuote || routeLoading} />
      </View>
    </View>
    {paymentPickerOpen && <PaymentSheet selected={ride.paymentPreference} onClose={() => setPaymentPickerOpen(false)} onSelect={(preference) => { onPaymentPreferenceChange(preference); setPaymentPickerOpen(false); }} />}
    {offersOpen && <OffersSheet onClose={() => setOffersOpen(false)} />}
  </SafeAreaView>;
}

function PaymentSheet({ selected, onClose, onSelect }: { selected?: PaymentPreference; onClose: () => void; onSelect: (preference: PaymentPreference) => void }) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  return <Modal transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}><View style={styles.fullScreenSheetOverlay}><Pressable onPress={onClose} style={StyleSheet.absoluteFill} /><View style={[styles.modalActionSheet, { paddingBottom: Math.max(22, bottom + 16) }, shadows.card, styles.modalSheetSurface]}><View style={styles.modalSheetHandle} /><View style={styles.offersHeader}><Text style={styles.offersTitle}>Payment method</Text><Pressable onPress={onClose}><Text style={styles.offersClose}>×</Text></Pressable></View><PaymentPreferenceOption selected={selected !== 'upi'} label={t('rides.cash')} detail={t('rides.cashPreferenceDetail')} onPress={() => onSelect('cash')} /><PaymentPreferenceOption selected={selected === 'upi'} label={t('rides.payOnline')} detail={t('rides.payOnlinePreferenceDetail')} badge="₹" onPress={() => onSelect('upi')} /></View></View></Modal>;
}

function OffersSheet({ onClose }: { onClose: () => void }) {
  const [coupons, setCoupons] = useState<CustomerCoupon[]>([]); const [code, setCode] = useState('');
  const { bottom } = useSafeAreaInsets();
  useEffect(() => { void rideDispatchService.getCustomerAvailableCoupons().then(setCoupons).catch(() => setCoupons([])); }, []);
  return <Modal transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}><View style={styles.fullScreenSheetOverlay}><Pressable onPress={onClose} style={StyleSheet.absoluteFill} /><View style={[styles.offersSheet, { paddingBottom: Math.max(22, bottom + 16) }, shadows.card, styles.modalSheetSurface]}><View style={styles.modalSheetHandle} /><View style={styles.offersHeader}><Text style={styles.offersTitle}>Offers</Text><Pressable onPress={onClose}><Text style={styles.offersClose}>×</Text></Pressable></View><Text style={styles.offersLabel}>Coupons</Text><View style={styles.couponEntry}><TextInput value={code} onChangeText={(value) => setCode(value.toUpperCase())} placeholder="Enter coupon code" placeholderTextColor={colors.textMuted} autoCapitalize="characters" style={styles.couponInput} /><Text style={styles.couponApply}>APPLY</Text></View>{coupons.map((coupon) => <View key={coupon.code} style={styles.couponCard}><Text style={styles.couponTitle}>{coupon.title}</Text><Text style={styles.couponCopy}>{coupon.description || coupon.code}</Text></View>)}{!coupons.length && <Text style={styles.noCoupons}>No coupons are available currently.</Text>}</View></View></Modal>;
}

function PaymentPreferenceOption({ selected, label, detail, badge, onPress }: { selected: boolean; label: string; detail: string; badge?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => { selectionHaptic(); onPress(); }} style={[styles.paymentPreferenceOption, selected && styles.paymentPreferenceOptionSelected]}>
    <View style={[styles.paymentPreferenceBadge, badge && styles.paymentPreferenceUpiBadge]}><Text style={styles.paymentPreferenceBadgeText}>{badge ?? '₹'}</Text></View>
    <View style={styles.paymentPreferenceCopy}><Text style={styles.paymentPreferenceOptionLabel}>{label}</Text><Text style={styles.paymentPreferenceOptionDetail}>{detail}</Text></View>
    <View style={[styles.paymentPreferenceRadio, selected && styles.paymentPreferenceRadioSelected]}>{selected && <View style={styles.paymentPreferenceRadioDot} />}</View>
  </Pressable>;
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
  option: { kind: RideKind; fareDisplay: CustomerFareDisplay; eta: number };
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
  const selectedBackground = selectedValue.interpolate({ inputRange: [0, 1], outputRange: ['rgba(232,248,237,0)', colors.primaryLight] });
  return (
    <Pressable
      onPress={() => { selectionHaptic(); onSelect(); }}
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
          <VehicleIcon kind={option.kind} size={36} />
        </View>
        <View style={styles.rideTextWrap}>
          <Text style={styles.rideName}>{t(`rides.${option.kind}`)}</Text>
          <Text style={styles.rideDetail}>{t(`rides.${option.kind}Detail`)} · {(t as any)('rides.eta', { minutes: formatNumber(option.eta) })}</Text>
        </View>
        <CustomerFareValue display={option.fareDisplay} t={t} />
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

function PromotionOfferCard({ promotion, t, compact = false, strip = false }: { promotion: CustomerPromotionStatus | null; t: (key: string, options?: Record<string, unknown>) => string; compact?: boolean; strip?: boolean }) {
  if (!promotion?.promotion_enabled || promotion.remaining_free_rides <= 0) return null;
  if (strip) return <View style={styles.promotionStrip}><Text style={styles.promotionStripAccent}>●</Text><Text style={styles.promotionStripText} numberOfLines={2}>{t('rides.freeOfferCompact', { remaining: promotion.remaining_free_rides, distance: promotion.maximum_free_distance_meters / 1000 })}</Text></View>;
  return <View style={[styles.promotionCard, compact && styles.promotionCardCompact]}><Text style={styles.promotionTitle}>{t('rides.freeOfferActive')}</Text><Text style={styles.promotionDetail}>{t('rides.freeOfferSummary', { remaining: promotion.remaining_free_rides, maximum: promotion.maximum_free_rides, distance: promotion.maximum_free_distance_meters / 1000 })}</Text></View>;
}

export function CustomerOffersScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const [promotion, setPromotion] = useState<CustomerPromotionStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  useFocusEffect(useCallback(() => {
    void rideDispatchService.getCustomerPromotionStatus().then(setPromotion).catch(() => setPromotion(null)).finally(() => setLoaded(true));
  }, []));
  const eligible = Boolean(promotion?.promotion_enabled && promotion.remaining_free_rides > 0);
  return <ScreenShell back={onBack} title={t('rides.offers')}>
    {!loaded ? <Text style={styles.offersEmpty}>{t('login.pleaseWait')}</Text> : eligible ? <PromotionOfferCard promotion={promotion} t={t} /> : <Text style={styles.offersEmpty}>No offers being offered at the moment</Text>}
  </ScreenShell>;
}

function CustomerFareValue({ display, t, alignStart = false }: { display: CustomerFareDisplay; t: (key: string) => string; alignStart?: boolean }) {
  return <View style={[styles.rideFareWrap, alignStart && styles.rideFareWrapStart]}>{display.isFree && display.originalEstimatedFare != null ? <><Text style={[styles.rideFare, styles.rideFareStruck]}>{formatFare(display.originalEstimatedFare)}</Text><Text style={styles.rideFareFree}>{t('rides.freeRideAmount')}</Text><Text style={styles.rideOfferApplied}>{t('rides.freeOfferApplied')}</Text></> : <Text style={styles.rideFare}>{display.customerCharge == null ? '—' : formatFare(display.customerCharge)}</Text>}</View>;
}

/* ─────────────────────────── BOOKING CONFIRM ─────────────────────────── */

export function BookingConfirmScreen({
  ride,
  beforeBook,
  onBook,
  onBack,
  onInvalidRoute,
}: {
  ride: CustomerRide;
  beforeBook: () => Promise<boolean>;
  onBook: (ride: CustomerRide, rideId: string) => Promise<void>;
  onBack: () => void;
  onInvalidRoute: (target: LocationTarget) => void;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const routeQuote = hasUsableRouteQuote(ride.routeQuote) ? ride.routeQuote : undefined;
  const missingLocation = missingCustomerBookingLocation(ride);
  const [booking, setBooking] = useState(false);
  const bookingRef = useRef(false);
  const [promotion, setPromotion] = useState<CustomerPromotionStatus | null>(null);
  useEffect(() => { void rideDispatchService.getCustomerPromotionStatus().then(setPromotion).catch(() => setPromotion(null)); }, []);
  useEffect(() => { if (missingLocation) onInvalidRoute(missingLocation); }, [missingLocation, onInvalidRoute]);
  const fareDisplay = getCustomerFareDisplay({ kind: ride.kind, passengerCount: ride.passengerCount, routeQuote, promotion });
  const book = async () => {
    if (bookingRef.current) return;
    if (!routeQuote) {
      dialog({ title: t('rides.routeUnavailable') });
      return;
    }
    if (!await beforeBook()) return;
    bookingRef.current = true;
    setBooking(true);
    try {
      const createdRide = await rideCreationService.create(ride);
      const confirmedRide = await rideDispatchService.getRide(createdRide.id);
      const confirmedFareDisplay = getCustomerFareDisplay({ kind: ride.kind, passengerCount: ride.passengerCount, routeQuote, promotion, backendRide: confirmedRide });
      const previewWasFree = fareDisplay.isFree;
      if (previewWasFree && confirmedRide.customer_charge_type !== 'free') {
        dialog({ title: t('rides.freeOfferNoLongerAvailable', { fare: formatFare(confirmedFareDisplay.customerCharge ?? 0) }) });
      }
      void rideDispatchService.getCustomerPromotionStatus().then(setPromotion).catch(() => setPromotion(null));
      await onBook(ride, createdRide.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      dialog({ title: message.includes('Route quote expired') ? 'Route expired. Go back and refresh the route before booking.' : t('login.tryAgain') });
    } finally {
      bookingRef.current = false;
      setBooking(false);
    }
  };
  if (missingLocation) return <View style={styles.bookingRouteRecovery}><ActivityIndicator /></View>;
  return (
    <ScreenShell back={onBack} title={t('screens.bookingConfirm')}>
      <View style={[styles.summaryCard, shadows.card]}>
        <SummaryRow label={t('rides.pickup')} value={ride.pickup} icon="●" locationTone="pickup" />
        <SummaryRow label={t('rides.drop')} value={ride.drop} icon="●" locationTone="drop" />
        <SummaryRow label={t('rides.ride')} value={t(`rides.${ride.kind}`)} vehicleKind={ride.kind} />
        {ride.kind === 'auto' && <SummaryRow label={t('rides.passengers')} value={formatNumber(ride.passengerCount)} icon="👤" />}
        <View style={[styles.summaryRow, styles.summaryRowDivider]}><Text style={styles.summaryIcon}>💰</Text><View style={styles.summaryText}><Text style={styles.summaryLabel}>{t('rides.estimate')}</Text><CustomerFareValue display={fareDisplay} t={t} alignStart /></View></View>
      </View>
      <OutstandingBalanceCard />
      <PrimaryButton label={booking ? t('login.pleaseWait') : t('rides.book')} onPress={() => { void book(); }} disabled={booking} />
    </ScreenShell>
  );
}

function SummaryRow({
  label,
  value,
  icon,
  vehicleKind,
  locationTone,
  last,
}: {
  label: string;
  value: string;
  icon?: string;
  vehicleKind?: RideKind;
  locationTone?: 'pickup' | 'drop';
  last?: boolean;
}) {
  return (
    <View style={[styles.summaryRow, !last && styles.summaryRowDivider]}>
      {locationTone ? <View style={[styles.summaryLocationIcon, locationTone === 'drop' && styles.summaryLocationIconDrop]}><Text style={[styles.summaryLocationIconText, locationTone === 'drop' && styles.summaryLocationIconTextDrop]}>{icon}</Text></View> : vehicleKind ? <View style={styles.summaryVehicleIcon}><VehicleIcon kind={vehicleKind} size={28} /></View> : <Text style={styles.summaryIcon}>{icon}</Text>}
      <View style={styles.summaryText}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────── SEARCHING ─────────────────────────── */

export function SearchingScreen({ rideId, rideKind, pickupCoordinate, nearbyCaptains, onFound, onBack, onUnavailable, onCancel, onHome, onBookings, onProfile }: { rideId?: string; rideKind: RideKind; pickupCoordinate?: Coordinate; nearbyCaptains?: NearbyCaptainLocation[]; onFound: () => void; onBack: () => void; onUnavailable?: () => void; onCancel: () => void; onHome: () => void; onBookings: () => void; onProfile: () => void }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const { tabBarHeight } = useBottomTabBarMetrics();
  const heartbeatScale = useRef(new Animated.Value(0.18)).current;
  const heartbeatOpacity = useRef(new Animated.Value(0.78)).current;
  const indicatorPhase = useRef(new Animated.Value(0)).current;
  const statusOpacity = useRef(new Animated.Value(1)).current;
  const statusTranslateY = useRef(new Animated.Value(0)).current;
  const [statusIndex, setStatusIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(true);
  const searchFinished = useRef(false);
  const statusMessages = useMemo(() => [
    t('rides.searchingNearbyStatus'),
    t('rides.searchingAreaStatus'),
    t('rides.searchingBestStatus'),
    t('rides.searchingAlmostStatus'),
  ], [t]);

  const finishFound = useCallback(() => {
    if (searchFinished.current) return;
    searchFinished.current = true;
    setIsSearching(false);
    onFound();
  }, [onFound]);
  const finishUnavailable = useCallback(() => {
    if (searchFinished.current) return;
    searchFinished.current = true;
    setIsSearching(false);
    onUnavailable?.();
  }, [onUnavailable]);

  useEffect(() => { setIsSearching(true); }, [rideId]);

  useEffect(() => {
    if (!isSearching) return;
    searchFinished.current = false;
    if (!rideId || rideId.startsWith('local-')) {
      const id = setTimeout(finishFound, 3500);
      return () => clearTimeout(id);
    }
    return rideDispatchService.subscribeToRide(rideId, (ride) => {
      if (ride.status === 'accepted' || ride.status === 'arrived' || ride.status === 'in_progress' || ride.status === 'completed') finishFound();
      if (ride.status === 'cancelled') finishUnavailable();
    });
  }, [finishFound, finishUnavailable, isSearching, rideId]);

  useEffect(() => {
    if (!isSearching) return;
    const heartbeat = Animated.loop(Animated.parallel([
      Animated.sequence([Animated.timing(heartbeatScale, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.timing(heartbeatScale, { toValue: 0.18, duration: 0, useNativeDriver: true })]),
      Animated.sequence([Animated.timing(heartbeatOpacity, { toValue: 0, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.timing(heartbeatOpacity, { toValue: 0.78, duration: 0, useNativeDriver: true })]),
    ]));
    const indicators = Animated.loop(Animated.sequence([Animated.timing(indicatorPhase, { toValue: 3, duration: 3000, easing: Easing.linear, useNativeDriver: true }), Animated.timing(indicatorPhase, { toValue: 0, duration: 0, useNativeDriver: true })]));
    heartbeat.start(); indicators.start();
    return () => { heartbeat.stop(); indicators.stop(); };
  }, [heartbeatOpacity, heartbeatScale, indicatorPhase, isSearching]);

  useEffect(() => {
    if (!isSearching) return;
    const interval = setInterval(() => {
      Animated.parallel([
        Animated.timing(statusOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(statusTranslateY, { toValue: -5, duration: 160, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (!finished || searchFinished.current) return;
        setStatusIndex((current) => (current + 1) % statusMessages.length);
        statusTranslateY.setValue(6);
        Animated.parallel([
          Animated.timing(statusOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.timing(statusTranslateY, { toValue: 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      });
    }, 2800);
    return () => clearInterval(interval);
  }, [isSearching, statusMessages.length, statusOpacity, statusTranslateY]);

  const autoOpacity = indicatorPhase.interpolate({ inputRange: [0, 0.8, 1, 2.8, 3], outputRange: [1, 1, 0, 0, 1] });
  const bikeOpacity = indicatorPhase.interpolate({ inputRange: [0, 0.8, 1, 1.8, 2, 3], outputRange: [0, 0, 1, 1, 0, 0] });
  const nandyalOpacity = indicatorPhase.interpolate({ inputRange: [0, 1.8, 2, 2.8, 3], outputRange: [0, 0, 1, 1, 0] });
  const confirmCancel = () => dialog({
    title: t('rides.searchingCancelTitle'),
    message: t('rides.searchingCancelMessage'),
    buttons: [
      { text: t('rides.stay'), style: 'cancel' },
      {
        text: t('rides.confirmCancel'), style: 'destructive', onPress: () => {
          if (!rideId || rideId.startsWith('local-')) { setIsSearching(false); return onCancel(); }
          void rideCreationService.cancel(rideId, 'change_plans').then(() => { setIsSearching(false); onCancel(); }).catch(() => dialog({ title: t('login.tryAgain') }));
        }
      },
    ],
  });

  // The stack's hardware/system back action bypasses ScreenShell's visible
  // back button, so intercept it here and use the same cancellation choice.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmCancel();
      return true;
    });
    return () => subscription.remove();
  }, [rideId, t]);

  return <View style={styles.searchingScreen}>
    <SearchingMap pickup={pickupCoordinate} searchKey={rideId} nearbyCaptains={nearbyCaptains} heartbeatScale={heartbeatScale} heartbeatOpacity={heartbeatOpacity} />
    <View pointerEvents="none" style={styles.searchingMapDim} />
    <SafeAreaView pointerEvents="box-none" style={styles.searchingSafe} edges={['top', 'left', 'right']}>
      <View style={styles.searchingHeader}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('actions.back')} onPress={confirmCancel} style={styles.searchingBackButton}><Text style={styles.searchingBackText}>{t('actions.back')}</Text></Pressable>
        <Text style={styles.searchingHeaderTitle} numberOfLines={1}>{t('rides.searchingTitle')}</Text>
        <View style={styles.searchingHeaderSpacer} />
      </View>
    </SafeAreaView>
    <View style={[styles.searchingPanel, { bottom: tabBarHeight + 16 }, shadows.card]}>
      <View style={styles.searchingLoopIndicator} accessibilityLabel={`${t(`rides.${rideKind}`)}. I love NDL`}>
        <Animated.View style={[styles.searchingLoopItem, { opacity: autoOpacity }]}><VehicleIcon kind="auto" size={30} /></Animated.View>
        <Animated.View style={[styles.searchingLoopItem, { opacity: bikeOpacity }]}><VehicleIcon kind="bike" size={30} /></Animated.View>
        <Animated.Text style={[styles.searchingLoopItem, styles.searchingNandyalMark, { opacity: nandyalOpacity }]}>I ❤️ NDL</Animated.Text>
      </View>
      <Text style={styles.searchingTitle}>{t('rides.searchingTitle')}</Text>
      <Animated.Text style={[styles.searchingSubtitle, { opacity: statusOpacity, transform: [{ translateY: statusTranslateY }] }]}>{statusMessages[statusIndex]}</Animated.Text>
    </View>
    <CustomerTabBar active="bookings" onHome={onHome} onBookings={onBookings} onProfile={onProfile} />
  </View>;
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

export function RideConfirmedScreen({ ride, onHome, onCancelled, onBookings, onProfile, onOpenChat, onPickupOtpIssued, onShareLiveRide }: { ride: CustomerRide; onHome: () => void; onCancelled: () => void; onBookings: () => void; onProfile: () => void; onOpenChat: (rideId: string, captainName: string) => void; onPickupOtpIssued: (pickupOtp: string) => void; onShareLiveRide: (rideId: string) => void }) {
  const { t } = useTranslation();
  const { bottomInset, tabBarHeight } = useBottomTabBarMetrics();
  const { height: windowHeight } = useWindowDimensions();
  const dialog = useDialog();
  const mapRef = useRef<MapView>(null);
  const [cancelStep, setCancelStep] = useState<'none' | 'confirm' | 'reason'>('none');
  const [cancellationReason, setCancellationReason] = useState<CancellationReason | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [cancellationError, setCancellationError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [liveStatus, setLiveStatus] = useState<RideStatus>('accepted');
  const [liveRide, setLiveRide] = useState<DispatchRide | null>(null);
  const [captainDetails, setCaptainDetails] = useState<AssignedCaptainDetails | null>(null);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [pickupPin, setPickupPin] = useState<string | null>(ride.pickupOtp ?? null);
  const pickupOtpIssuedForRide = useRef<string | null>(null);
  const [captainRoute, setCaptainRoute] = useState<Coordinate[]>([]);
  const pickup = ride.pickupCoordinate ?? locationCoordinate(ride.pickup, 0);
  const hasCurrentRide = liveRide?.id === ride.id && liveRide?.status !== 'cancelled';
  const arrived = liveStatus === 'arrived' || liveStatus === 'in_progress' || liveStatus === 'completed';
  const canCancel = liveStatus === 'searching' || liveStatus === 'accepted' || liveStatus === 'in_progress';
  const cancellationMayIncurCharge = liveStatus === 'in_progress';
  const captainName = captainDetails?.fullName || t('rides.captain');
  const vehicleType = captainDetails?.vehicleType;
  const callCaptain = async () => {
    const phone = captainDetails?.phone?.replace(/[^+\d]/g, '');
    if (!phone) return;
    try {
      if (await Linking.canOpenURL(`tel:${phone}`)) await Linking.openURL(`tel:${phone}`);
    } catch {
      dialog({ title: t('login.tryAgain') });
    }
  };

  const framedRideState = useRef<string | null>(null);
  useEffect(() => {
    const key = `${ride.id ?? 'local'}:${liveStatus}:${captainRoute.length}`;
    if (framedRideState.current === key) return;
    const route = captainRoute.length > 1 ? captainRoute : [pickup];
    const fitted = route.length > 1
      ? fitRouteInVisibleViewport(mapRef.current, route, getVisibleMapPadding({ top: 72, bottomSheetHeight: 280, bottomInset: tabBarHeight }))
      : false;
    if (fitted) framedRideState.current = key;
    else if (isValidMapCoordinate(pickup)) {
      mapRef.current?.animateToRegion({ ...pickup, latitudeDelta: HOME_LOCATION_DELTA, longitudeDelta: HOME_LOCATION_DELTA }, 300);
      framedRideState.current = key;
    }
  }, [captainRoute, liveStatus, pickup, ride.id, tabBarHeight]);
  useEffect(() => {
    setLiveRide(null);
    setCaptainDetails(null);
    setPickupPin(ride.pickupOtp ?? null);
    setCaptainRoute([]);
  }, [ride.id]);
  useEffect(() => {
    if (!ride.id || ride.id.startsWith('local-')) return;
    return rideDispatchService.subscribeToRide(ride.id, (updatedRide) => {
      setLiveStatus(updatedRide.status);
      setLiveRide(updatedRide);
      if (updatedRide.captain_id) {
        void rideDispatchService.getAssignedCaptain(updatedRide.id).then(setCaptainDetails).catch(() => setCaptainDetails(null));
      }
      if (updatedRide.status === 'arrived' && !ride.pickupOtp && pickupOtpIssuedForRide.current !== updatedRide.id) {
        pickupOtpIssuedForRide.current = updatedRide.id;
        void rideDispatchService.issueCustomerPickupOtp(updatedRide.id).then((pickupOtp) => {
          setPickupPin(pickupOtp);
          if (pickupOtp) onPickupOtpIssued(pickupOtp);
        }).catch(() => {
          pickupOtpIssuedForRide.current = null;
          setPickupPin(null);
        });
      }
    });
  }, [onHome, onPickupOtpIssued, ride.id, ride.pickupOtp]);
  useEffect(() => {
    if (!ride.id || ride.id.startsWith('local-')) {
      setUnreadMessageCount(0);
      return;
    }
    const rideId = ride.id;
    let active = true;
    const refreshUnreadCount = () => {
      void rideDispatchService.unreadRideMessageCount(rideId)
        .then((count) => { if (active) setUnreadMessageCount(count); })
        .catch(() => { if (active) setUnreadMessageCount(0); });
    };
    refreshUnreadCount();
    return rideDispatchService.subscribeToRideMessages(rideId, refreshUnreadCount);
  }, [ride.id]);
  useEffect(() => {
    if (!ride.id || ride.id.startsWith('local-')) return;
    const rideId = ride.id;
    let active = true;
    const loadRoute = () => {
      void googleMapsService.rideRoute(rideId, liveStatus === 'in_progress' ? 'initial_trip' : 'captain_to_pickup')
        .then((stored) => { if (active) setCaptainRoute(decodeGooglePolyline(stored.encoded_polyline)); })
        .catch(() => { if (active) setCaptainRoute([]); });
    };
    loadRoute();
    return undefined;
  }, [liveStatus, ride.id]);
  const startCancellation = () => {
    setCancellationReason(null);
    setOtherReason('');
    setCancellationError('');
    setCancelStep('confirm');
  };
  const submitCancellation = async () => {
    if (!cancellationReason) return setCancellationError(t('rides.cancelReasonRequired'));
    if (cancellationReason === 'other' && !otherReason.trim()) return setCancellationError(t('rides.cancelReasonOtherRequired'));
    setCancelling(true);
    try {
      const activeRide = await rideDispatchService.getCustomerActiveRide();
      const rideId = activeRide?.id ?? liveRide?.id ?? ride.id;
      if (!rideId || !activeRide || !isCustomerActiveRideStatus(activeRide.status)) throw new Error('Ride can no longer be cancelled');
      await rideCreationService.cancel(rideId, cancellationReason, otherReason);
      dialog({ title: t('rides.rideCancelled'), message: cancellationMayIncurCharge ? t('rides.cancellationChargePending') : undefined, buttons: [{ text: t('actions.done'), onPress: onCancelled }] });
    } catch {
      setCancellationError(t('login.tryAgain'));
    } finally {
      setCancelling(false);
    }
  };
  const liveFareDisplay = getCustomerFareDisplay({ kind: ride.kind, passengerCount: ride.passengerCount, routeQuote: ride.routeQuote, backendRide: liveRide });

  if (liveStatus === 'completed' && ride.id) {
    return <CustomerRideSettlement rideId={ride.id} fare={liveFareDisplay.customerCharge ?? 0} captainName={captainName} paymentStatus={liveRide?.payment_status ?? 'pending'} paymentMethod={liveRide?.payment_method} freeRide={liveFareDisplay.isFree} onHome={onHome} />;
  }
  const displayedCaptainCoordinate = liveRide?.captain_latitude != null && liveRide?.captain_longitude != null
    ? { latitude: Number(liveRide.captain_latitude), longitude: Number(liveRide.captain_longitude) }
    : null;
  const displayedApproachRoute = captainRoute.length > 1 ? captainRoute : [];
  const inProgress = liveStatus === 'in_progress';
  const captainFinishingNearbyRide = liveStatus === 'accepted' && Boolean(liveRide?.queued_after_ride_id);

  return <SafeAreaView style={styles.assignedSafe} edges={['top', 'left', 'right']}>
    <MapView ref={mapRef} provider={mapProvider} initialRegion={NANDYAL} style={StyleSheet.absoluteFill}>
      <Marker coordinate={pickup} pinColor={colors.success} title={t('rides.pickup')} />
      {displayedApproachRoute.length > 1 && <Polyline coordinates={displayedApproachRoute} strokeColor={colors.primaryDark} strokeWidth={5} />}
      {displayedCaptainCoordinate && <Marker.Animated coordinate={displayedCaptainCoordinate}><View style={styles.liveCaptainMarker}><VehicleIcon kind={vehicleType ?? ride.kind} size={28} /></View></Marker.Animated>}
    </MapView>
    <Pressable onPress={onHome} accessibilityRole="button" style={[styles.assignedBack, shadows.soft]}><Text style={styles.rideOptionsBackText}>‹</Text></Pressable>
    <DraggableMapSheet bottom={tabBarHeight} collapsedHeight={280} maxHeight={windowHeight} style={[styles.assignedSheet, shadows.card]} contentContainerStyle={[styles.assignedSheetContent, { paddingBottom: 24 + bottomInset }]}>
      {!arrived && <Text style={styles.bookingStatus}>{liveStatus === 'accepted' ? t('rides.bookedMessage') : t('rides.searchingSubtitle')}</Text>}
      {captainFinishingNearbyRide && <View style={styles.nearbyRideNotice}><Text style={styles.nearbyRideNoticeTitle}>Your Captain is completing a nearby ride</Text><Text style={styles.nearbyRideNoticeText}>They will head to your pickup as soon as that ride is complete.</Text></View>}
      <View style={styles.assignedHeading}><View><Text style={styles.assignedTitle}>{t(inProgress ? 'rides.startedTitle' : arrived ? 'rides.hereTitle' : 'rides.confirmedTitle')}</Text><Text style={styles.assignedSubtitle}>{inProgress ? t('rides.startedSubtitle') : arrived ? t('rides.hereSubtitle') : t('rides.arriving')}</Text></View></View>
      {hasCurrentRide && <View style={styles.assignedCaptainRow}><View style={styles.captainAvatar}><Text style={styles.captainAvatarEmoji}>👤</Text></View><View style={styles.assignedCaptainText}><Text style={styles.captainName}>{captainName}</Text><Text style={styles.assignedVehicle}>{vehicleType ? t(`rides.${vehicleType}`) : t('rides.captain')}</Text></View><View style={styles.assignedContact}><Pressable onPress={() => { if (ride.id) onOpenChat(ride.id, captainName); }} accessibilityRole="button" accessibilityLabel="Message captain" accessibilityState={{ disabled: !ride.id }} disabled={!ride.id} style={[styles.assignedCall, !ride.id && styles.assignedCallDisabled]}><View><Text style={styles.assignedCallText}>✉</Text>{unreadMessageCount > 0 && <View style={styles.messageUnreadBadge}><Text style={styles.messageUnreadBadgeText}>{unreadMessageCount > 9 ? '9+' : unreadMessageCount}</Text></View>}</View></Pressable><Pressable onPress={() => { void callCaptain(); }} accessibilityRole="button" accessibilityLabel="Call captain" accessibilityState={{ disabled: !captainDetails?.phone }} disabled={!captainDetails?.phone} style={[styles.assignedCall, !captainDetails?.phone && styles.assignedCallDisabled]}><Text style={styles.assignedCallText}>☎</Text></Pressable></View></View>}
      <View style={styles.assignedPickupRow}><View style={styles.assignedPickupDot} /><Text style={styles.assignedPickupText} numberOfLines={2}>{t('rides.pickup')} · {ride.pickup}</Text></View>
      <View style={styles.assignedPickupRow}><View style={[styles.assignedPickupDot, styles.assignedDropDot]} /><Text style={styles.assignedPickupText} numberOfLines={2}>{t('rides.drop')} · {ride.drop}</Text></View>
      {arrived && !!pickupPin && !inProgress && <View style={styles.pickupPinCard}><Text style={styles.pickupPinLabel}>{t('rides.pickupPinLabel')}</Text><Text style={styles.pickupPin}>{pickupPin}</Text><Text style={styles.pickupPinHint}>{t('rides.pickupPinHint')}</Text></View>}
      {inProgress && <><View style={styles.tripStatRow}><Text style={styles.tripStatLabel}>{t('rides.destinationDistance')}</Text><Text style={styles.tripStatValue}>{liveRide?.trip_distance_meters == null ? '—' : `${formatNumber(Number(liveRide.trip_distance_meters) / 1000, { maximumFractionDigits: 1 })} km`}</Text></View><Pressable onPress={() => { void emergencyContactsService.list().then((contacts) => { if (!contacts.length) { dialog({ title: 'Emergency contacts', message: 'You do not have any saved contacts.' }); return; } dialog({ title: 'Call emergency contact', message: 'Choose a saved contact to call.', buttons: [...contacts.map((contact) => ({ text: contact.contactName, onPress: () => { void Linking.openURL(`tel:${contact.phoneNumber}`); } })), { text: 'Call emergency services (112)', onPress: () => { void Linking.openURL('tel:112'); } }, { text: t('actions.cancel'), style: 'cancel' }] }); }).catch(() => dialog({ title: 'Emergency contacts', message: 'You do not have any saved contacts.' })); }} accessibilityRole="button" style={styles.sosButton}><Text style={styles.sosText}>{t('rides.sos')}</Text></Pressable><PrimaryButton label="Share live ride status" onPress={() => onShareLiveRide(liveRide?.id ?? ride.id!)} /></>}
      {canCancel && <PrimaryButton label={t('rides.cancelRide')} onPress={startCancellation} danger />}
    </DraggableMapSheet>
    <CustomerTabBar active="bookings" onHome={onHome} onBookings={onBookings} onProfile={onProfile} />
    {cancelStep !== 'none' && <Modal transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setCancelStep('none')}><View style={styles.cancellationOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setCancelStep('none')} />
      <View style={[styles.cancellationSheet, { paddingBottom: Math.max(48, bottomInset + 24) }, shadows.card, styles.modalSheetSurface]}>
        <View style={styles.sheetHandle} />
        <ScrollView bounces={false} contentContainerStyle={styles.cancellationContent} showsVerticalScrollIndicator={false}>
          {cancelStep === 'confirm' ? <>
            <Text style={styles.cancellationTitle}>{t('rides.cancelTitle')}</Text>
            <View style={styles.captainStatusCard}>
              <VehicleIcon kind={vehicleType ?? ride.kind} size={34} />
              <View style={styles.captainStatusText}><Text style={styles.captainStatusTitle}>{captainName}</Text><Text style={styles.captainStatusMessage}>{inProgress ? t('rides.startedSubtitle') : liveStatus === 'arrived' ? t('rides.cancelArrivalStatus', { captain: captainName }) : t('rides.bookedMessage')}</Text></View>
            </View>
            {cancellationMayIncurCharge && <Text style={styles.cancellationMessage}>{t('rides.cancellationChargeWarning')}</Text>}
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
    </View></Modal>}
  </SafeAreaView>;
}

function BookingDetailsSheet({ ride, captain, onClose, onOpenSupport, onOpenIssue }: { ride: DispatchRide; captain: AssignedCaptainDetails | null | undefined; onClose: () => void; onOpenSupport: (rideId: string) => void; onOpenIssue: (issueId: string) => void }) {
  const { t, i18n } = useTranslation();
  const { bottomInset } = useBottomTabBarMetrics();
  const progress = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  const [issue, setIssue] = useState<CustomerIssueHistoryItem | null | undefined>(undefined);
  const [helpOpen, setHelpOpen] = useState(false);
  const [issueChatOpen, setIssueChatOpen] = useState(false);
  const fareDisplay = getCustomerFareDisplay({ kind: ride.ride_type, passengerCount: Number(ride.passenger_count ?? 1), backendRide: ride });
  const rating = Number(ride.customer_rating ?? 0);
  useEffect(() => { Animated.timing(progress, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [progress]);
  useEffect(() => { if (ride.status !== 'completed' || !rideDispatchService.isEnabled) { setIssue(null); return; } const load = () => { void rideDispatchService.getCustomerIssuesForRide(ride.id).then((issues) => setIssue(issues[0] ?? null)).catch(() => setIssue(null)); }; load(); const interval = setInterval(load, 8_000); return () => clearInterval(interval); }, [ride.id, ride.status]);
  const dismiss = useCallback(() => { if (closing) return; setClosing(true); Animated.timing(progress, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) onClose(); }); }, [closing, onClose, progress]);
  // Ride Details is an overlay over Bookings, so Android Back must close it
  // rather than pop the navigator to whichever tab preceded Bookings.
  useEffect(() => {
    if (issueChatOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismiss();
      return true;
    });
    return () => subscription.remove();
  }, [dismiss, issueChatOpen]);
  if (issueChatOpen) return <RideIssueChat rideId={ride.id} onClose={() => setIssueChatOpen(false)} onRegistered={() => { void rideDispatchService.getCustomerIssuesForRide(ride.id).then((issues) => setIssue(issues[0] ?? null)).catch(() => undefined); }} onEscalate={() => { setIssueChatOpen(false); onOpenSupport(ride.id); }} />;
  return <Animated.View style={[styles.bookingDetailsOverlay, { opacity: progress }]}>
    <Pressable onPress={dismiss} style={StyleSheet.absoluteFill} accessibilityRole="button" />
    <Animated.View style={[styles.bookingDetailsSheet, { paddingBottom: 24 + bottomInset }, shadows.card, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }] }]}>
      <View style={styles.sheetHandle} />
      <View style={styles.bookingDetailsHero}><View style={styles.bookingDetailsHeroIcon}><VehicleIcon kind={ride.ride_type} size={34} /></View><View style={styles.bookingDetailsHeroText}><Text style={styles.bookingDetailsTitle}>{t('rides.rideDetailsTitle')}</Text><Text style={styles.bookingDetailsStatus}>{t(`rides.status${ride.status}`)}</Text></View><Pressable onPress={dismiss} accessibilityRole="button" style={styles.bookingDetailsClose}><Text style={styles.bookingDetailsCloseText}>×</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.bookingDetailsContent} showsVerticalScrollIndicator={false}>
        <View style={styles.bookingDetailsSection}><Text style={styles.bookingDetailsSectionTitle}>{t('rides.routeDetails')}</Text><View style={styles.rideIdRow}><Text style={styles.bookingDetailLabel}>Ride ID</Text><Text selectable style={styles.rideIdValue}>{ride.id}</Text></View><View style={styles.bookingDetailRow}><View style={styles.assignedPickupDot} /><View style={styles.bookingDetailText}><View style={styles.bookingDetailLabelRow}><Text style={styles.bookingDetailLabel}>{t('rides.pickup')}</Text>{ride.arrived_at && <Text style={styles.bookingDetailTime}>{formatRideArrivalTime(ride.arrived_at, i18n.language)}</Text>}</View><Text style={styles.bookingDetailValue}>{ride.pickup_address}</Text></View></View><View style={styles.bookingDetailDivider} /><View style={styles.bookingDetailRow}><View style={[styles.assignedPickupDot, styles.assignedDropDot]} /><View style={styles.bookingDetailText}><View style={styles.bookingDetailLabelRow}><Text style={styles.bookingDetailLabel}>{t('rides.drop')}</Text>{ride.completed_at && <Text style={styles.bookingDetailTime}>{formatRideArrivalTime(ride.completed_at, i18n.language)}</Text>}</View><Text style={styles.bookingDetailValue}>{ride.drop_address}</Text></View></View></View>
        <View style={styles.bookingDetailsSection}><Text style={styles.bookingDetailsSectionTitle}>{t('rides.fareDetails')}</Text><View style={styles.bookingFareGrid}><View style={styles.bookingFareTile}><Text style={styles.bookingDetailLabel}>{t('rides.customerCharge')}</Text><Text style={styles.bookingDetailAmountValue}>{fareDisplay.isFree ? t('rides.freeRideAmount') : formatFare(fareDisplay.customerCharge ?? 0)}</Text></View>{fareDisplay.finalFare != null && <View style={styles.bookingFareTile}><Text style={styles.bookingDetailLabel}>{t('rides.finalFare')}</Text><Text style={styles.bookingDetailAmountValue}>{formatFare(fareDisplay.finalFare)}</Text></View>}</View>{Number(ride.cancellation_charge ?? 0) > 0 && <View style={styles.bookingDetailAmount}><Text style={styles.bookingDetailLabel}>{t('rides.cancellationCharge')}</Text><Text style={styles.bookingDetailAmountValue}>{formatFare(Number(ride.cancellation_charge))}</Text></View>}</View>
        <View style={styles.bookingDetailsSection}><Text style={styles.bookingDetailsSectionTitle}>{t('rides.captainDetails')}</Text><View style={styles.bookingCaptainRow}><View style={styles.bookingCaptainAvatar}><Text style={styles.bookingCaptainAvatarText}>👤</Text></View><View style={styles.bookingDetailText}>{captain === undefined ? <Text style={styles.bookingDetailLoading}>{t('login.pleaseWait')}</Text> : captain ? <><Text style={styles.bookingDetailValue}>{captain.fullName}</Text><Text style={styles.bookingDetailLabel}>{captain.vehicleType ? t(`rides.${captain.vehicleType}`) : t('rides.captain')}</Text></> : <Text style={styles.bookingDetailLabel}>{t('rides.noCaptainAssigned')}</Text>}</View></View></View>
        <View style={styles.bookingDetailsSection}><Text style={styles.bookingDetailsSectionTitle}>{t('rides.ratingGiven')}</Text><View style={styles.bookingRatingRow}>{rating > 0 ? <><Text style={styles.bookingRating}>{'★'.repeat(Math.min(5, rating))}{'☆'.repeat(Math.max(0, 5 - rating))}</Text><Text style={styles.bookingRatingNumber}>{rating}/5</Text></> : <Text style={styles.bookingDetailLabel}>{t('rides.notRatedYet')}</Text>}</View></View>
        <Pressable accessibilityRole="button" onPress={() => setIssueChatOpen(true)} style={styles.raiseIssueButton}><Text style={styles.raiseIssueButtonText}>{t('rides.raisePaymentIssue')}</Text></Pressable>
        {issue && <View style={[styles.bookingDetailsSection, issue.status === 'resolved' && styles.resolvedIssueSection]}><View style={styles.bookingDetailLabelRow}><Text style={styles.bookingDetailsSectionTitle}>{issue.status === 'resolved' ? 'Issue resolved' : t('rides.yourRaisedIssue')}</Text>{(issue.unread_support_messages ?? 0) > 0 ? <View style={styles.supportUnreadBadge}><Text style={styles.supportUnreadBadgeText}>{t('rides.customerSupportUnread', { count: issue.unread_support_messages })}</Text></View> : null}</View><Text style={styles.bookingDetailValue}>{issue.reason.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}</Text>{issue.status === 'resolved' && issue.resolution_note ? <Text style={styles.bookingDetailLabel}>{issue.resolution_note}</Text> : issue.customer_note ? <Text style={styles.bookingDetailLabel}>{issue.customer_note}</Text> : null}<Pressable accessibilityRole="button" onPress={() => { dismiss(); onOpenIssue(issue.id); }} style={styles.bookingDetailsButton}><Text style={styles.bookingDetailsButtonText}>{issue.status === 'resolved' ? 'View issue details' : t('rides.getHelpWithIssue')}</Text></Pressable>{issue.status === 'open' && <>{<Pressable accessibilityRole="button" onPress={() => setHelpOpen((open) => !open)} style={styles.bookingDetailsButton}><Text style={styles.bookingDetailsButtonText}>{t('rides.messageSupport')}</Text></Pressable>}{helpOpen && <View style={styles.bookingHelpActions}><Pressable accessibilityRole="button" onPress={() => onOpenSupport(ride.id)} style={styles.bookingDetailsButton}><Text style={styles.bookingDetailsButtonText}>{t('rides.messageSupport')}</Text></Pressable><Pressable accessibilityRole="button" onPress={() => { void Linking.openURL(`tel:${legalOperator.phone}`); }} style={styles.bookingDetailsButton}><Text style={styles.bookingDetailsButtonText}>{t('rides.callSupport')}</Text></Pressable></View>}</>}</View>}
      </ScrollView>
      <PrimaryButton label={t('actions.done')} onPress={dismiss} />
    </Animated.View>
  </Animated.View>;
}

type RideIssueOption = { key: string; label: string; children?: RideIssueOption[]; other?: boolean };
const rideIssueOptions: RideIssueOption[] = [
  { key: 'fare_or_payment', label: 'Fare or payment problem', children: [
    { key: 'charged_wrong_price', label: 'Charged wrong price', children: [{ key: 'fare_mismatch', label: 'Total fare was more/less than final charged fare' }, { key: 'captain_charging_extra', label: 'Captain charging extra' }, { key: 'other', label: 'Other', other: true }] },
    { key: 'promo_not_applied', label: "Couldn't apply promo" },
    { key: 'unable_to_pay_online', label: 'Unable to pay online', children: [{ key: 'upi_offline', label: 'UPI is not working/offline' }, { key: 'captain_not_accepting_upi', label: 'Captain not accepting UPI' }, { key: 'other', label: 'Other', other: true }] },
    { key: 'other', label: 'Other', other: true },
  ] },
  { key: 'safety', label: 'Safety concern', children: [
    { key: 'unsafe_driving', label: 'Unsafe or rash driving' }, { key: 'harassment_or_inappropriate_behaviour', label: 'Harassment or inappropriate behaviour' }, { key: 'felt_threatened', label: 'I felt threatened or unsafe' },
    { key: 'accident_or_crash', label: 'Accident or crash', children: [{ key: 'injury', label: 'I was injured' }, { key: 'vehicle_or_property_damage', label: 'Vehicle or property damage' }, { key: 'other', label: 'Other', other: true }] },
    { key: 'captain_details_do_not_match', label: 'Captain details do not match' }, { key: 'vehicle_details_do_not_match', label: 'Vehicle details do not match' }, { key: 'other', label: 'Other', other: true },
  ] },
  { key: 'captain_or_ride', label: 'Captain or ride issue', children: [{ key: 'captain_rude', label: 'Captain is rude' }, { key: 'long_route', label: 'Taking long route unnecessarily' }, { key: 'captain_charging_extra', label: 'Captain charging extra' }, { key: 'preferred_payment_not_accepted', label: 'Not accepting preferred payment method' }, { key: 'other', label: 'Other', other: true }] },
  { key: 'lost_item', label: 'Lost item', children: [{ key: 'lost_phone_or_electronic', label: 'Phone or electronic item' }, { key: 'lost_bag_or_luggage', label: 'Bag or luggage' }, { key: 'lost_wallet_or_documents', label: 'Wallet, ID, or documents' }, { key: 'captain_found_item', label: 'Captain found my item' }, { key: 'item_may_be_stolen', label: 'I think my item was stolen' }, { key: 'other', label: 'Other', other: true }] },
  { key: 'other', label: 'Other', other: true },
];

function RideIssueChat({ rideId, onClose, onRegistered, onEscalate }: { rideId: string; onClose: () => void; onRegistered: () => void; onEscalate: () => void }) {
  const [path, setPath] = useState<RideIssueOption[]>([]); const [finalOption, setFinalOption] = useState<RideIssueOption | null>(null); const [note, setNote] = useState(''); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false); const [error, setError] = useState('');
  const choices = path.length ? path[path.length - 1].children ?? [] : rideIssueOptions;
  const submit = async (option: RideIssueOption) => { if (option.other && !note.trim()) { setError('Please describe your issue.'); return; } setSaving(true); setError(''); try { await rideDispatchService.raiseCustomerPaymentIssue(rideId, path[0]?.key ?? option.key, option.key, option.other ? note : undefined); setFinalOption(option); setSaved(true); onRegistered(); } catch { setError('We could not save your issue. Please try again.'); } finally { setSaving(false); } };
  const choose = (option: RideIssueOption) => { setError(''); if (option.children) { setPath((current) => [...current, option]); return; } if (option.other) { setFinalOption(option); return; } void submit(option); };
  const contactSupport = async () => { setSaving(true); setError(''); try { await rideDispatchService.requestCustomerIssueSupport(rideId); onEscalate(); } catch { setError('We could not start support chat. Please try again.'); } finally { setSaving(false); } };
  const back = useCallback(() => { if (saved || finalOption) { setFinalOption(null); setSaved(false); setNote(''); return; } if (path.length) { setPath((current) => current.slice(0, -1)); return; } onClose(); }, [finalOption, onClose, path.length, saved]);
  // This is an in-place overlay, not a stack route. Consume Android's system
  // back event so it returns through the issue flow instead of popping Bookings.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back]);
  return <View style={styles.issueChatOverlay}><SafeAreaView style={styles.issueChatSafe} edges={['top', 'left', 'right']}><ScreenHeader back={back} title="Raise issue" /><ScrollView contentContainerStyle={styles.issueChatContent} keyboardShouldPersistTaps="handled"><Text style={styles.issueChatRide}>Ride ID: {rideId}</Text><View style={styles.botBubble}><Text style={styles.botBubbleText}>{saved ? 'Thanks, we’ve noted this issue. Would you like to contact customer support for help?' : finalOption?.other ? 'Please describe the issue in your own words.' : path.length ? 'Please choose the option that best describes the issue.' : 'Hi, I’m Sawaari Support. What can we help with for this ride?'}</Text></View>{error ? <Text style={styles.error}>{error}</Text> : null}{saved ? <><Pressable disabled={saving} onPress={() => { void contactSupport(); }} style={styles.issueChoice}><Text style={styles.issueChoiceText}>{saving ? 'Starting chat…' : 'Contact customer support'}</Text></Pressable><Pressable onPress={onClose} style={styles.issueChoice}><Text style={styles.issueChoiceText}>No, I’m all set</Text></Pressable></> : finalOption?.other ? <><TextInput value={note} onChangeText={setNote} maxLength={500} multiline placeholder="Describe what happened" placeholderTextColor={colors.textMuted} style={styles.issueNoteInput} /><Pressable disabled={saving} onPress={() => { void submit(finalOption); }} style={styles.issueChoice}><Text style={styles.issueChoiceText}>{saving ? 'Saving…' : 'Submit issue'}</Text></Pressable></> : <>{path.length ? <View style={styles.customerBubble}><Text style={styles.botBubbleText}>{path.map((item) => item.label).join(' › ')}</Text></View> : null}<Text style={styles.issueChatPrompt}>Choose an issue</Text>{choices.map((option) => <Pressable key={`${path.map((item) => item.key).join('-')}-${option.key}`} disabled={saving} onPress={() => choose(option)} style={styles.issueChoice}><Text style={styles.issueChoiceText}>{option.label}</Text></Pressable>)}</>}</ScrollView></SafeAreaView></View>;
}

export function CustomerBookingsScreen({ ride, onHome, onProfile, onCancelled, onOpenRide, onOpenSupport, onOpenIssue }: { ride: CustomerRide; onHome: () => void; onProfile: () => void; onCancelled: () => void; onOpenRide: (ride: CustomerRide, status: RideStatus) => void; onOpenSupport: (rideId: string) => void; onOpenIssue: (issueId: string) => void }) {
  const { t, i18n } = useTranslation();
  const { tabBarHeight } = useBottomTabBarMetrics();
  const dialog = useDialog();
  const [history, setHistory] = useState<DispatchRide[]>(() => customerRideHistorySnapshot ?? []); const [loaded, setLoaded] = useState(!rideDispatchService.isEnabled || customerRideHistorySnapshot !== null); const [filter, setFilter] = useState<RideHistoryFilter>(() => defaultRideHistoryFilter()); const [cancellingRideId, setCancellingRideId] = useState<string | null>(null); const [detailsRide, setDetailsRide] = useState<DispatchRide | null>(null); const [detailsCaptain, setDetailsCaptain] = useState<AssignedCaptainDetails | null | undefined>(null);
  useEffect(() => {
    if (!rideDispatchService.isEnabled) return;
    return rideDispatchService.subscribeToCustomerRideHistory((rides) => { customerRideHistorySnapshot = rides; setHistory(rides); setLoaded(true); }, () => setLoaded(true));
  }, []);
  const localHistory = ride.id ? [{ id: ride.id, status: 'searching' as RideStatus, ride_type: ride.kind, pickup_address: ride.pickup, drop_address: ride.drop, pickup_latitude: ride.pickupCoordinate?.latitude ?? null, pickup_longitude: ride.pickupCoordinate?.longitude ?? null, drop_latitude: ride.dropCoordinate?.latitude ?? null, drop_longitude: ride.dropCoordinate?.longitude ?? null }] as DispatchRide[] : [];
  const rides = useMemo(() => filterAndSortRideHistory(rideDispatchService.isEnabled ? history : localHistory, filter), [filter, history, localHistory]);
  const cancel = (rideId: string) => dialog({
    title: t('rides.cancelTitle'),
    message: t('rides.searchingCancelMessage'),
    buttons: [
      { text: t('rides.stay'), style: 'cancel' },
      { text: t('rides.confirmCancel'), style: 'destructive', onPress: () => { setCancellingRideId(rideId); void rideCreationService.cancel(rideId, 'change_plans').then(onCancelled).catch(() => dialog({ title: t('login.tryAgain') })).finally(() => setCancellingRideId(null)); } },
    ],
  });
  const customerRide = (record: DispatchRide): CustomerRide => ({ id: record.id, kind: record.ride_type, passengerCount: record.ride_type === 'auto' ? Number(record.passenger_count ?? 1) : 1, pickup: record.pickup_address, drop: record.drop_address, ...(record.pickup_latitude != null && record.pickup_longitude != null ? { pickupCoordinate: { latitude: Number(record.pickup_latitude), longitude: Number(record.pickup_longitude) } } : {}), ...(record.drop_latitude != null && record.drop_longitude != null ? { dropCoordinate: { latitude: Number(record.drop_latitude), longitude: Number(record.drop_longitude) } } : {}) });
  const openDetails = (record: DispatchRide) => { setDetailsRide(record); setDetailsCaptain(record.captain_id ? undefined : null); if (record.captain_id && rideDispatchService.isEnabled) void rideDispatchService.getAssignedCaptain(record.id).then(setDetailsCaptain).catch(() => setDetailsCaptain(null)); };
  return <SafeAreaView style={styles.bookingsSafe} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={[styles.bookingsContent, { paddingBottom: tabBarHeight + 24 }]} showsVerticalScrollIndicator={false}>
      <Text style={historyTypography.title}>{t('profile.history')}</Text>
      <RideHistoryFilterControl value={filter} onChange={setFilter} language={i18n.language} />
      {!loaded && <Text style={historyTypography.empty}>{t('login.pleaseWait')}</Text>}
      {loaded && !rides.length && <Text style={historyTypography.empty}>{filter.period === 'all' && filter.status === 'all' ? t('home.bookingsMessage') : t('history.empty')}</Text>}
      {rides.map((record) => {
        const canCancel = record.status === 'searching' || record.status === 'accepted';
        const actionLabel = record.status === 'cancelled' || record.status === 'completed' ? t('rides.bookThisRoute') : t('rides.viewRideStatus');
        const isCancelling = cancellingRideId === record.id;
        const statusLabel = record.status === 'completed' || record.status === 'cancelled'
          ? rideCardStatusLabel(record, i18n.language, t('rides.statuscompleted'), t('rides.statuscancelled'))
          : t(`rides.status${record.status}`);
        return <View key={record.id} style={[styles.bookingCard, shadows.card]}>
          <Text style={historyTypography.status}>{statusLabel}</Text>
          <View style={styles.bookingRouteStack}><View style={styles.bookingRouteMarker}><View style={styles.bookingPickupDot} /><View style={styles.bookingRouteLine} /><View style={styles.bookingDropDot} /></View><View style={styles.bookingRouteText}><Text style={historyTypography.route} numberOfLines={2}>{record.pickup_address}</Text><Text style={historyTypography.route} numberOfLines={2}>{record.drop_address}</Text></View></View>
          <View style={styles.bookingCardActions}><Pressable onPress={() => openDetails(record)} accessibilityRole="button" style={styles.bookingDetailsButton}><Text style={historyTypography.secondaryAction}>{t('rides.rideDetails')}</Text></Pressable><Pressable onPress={() => onOpenRide(customerRide(record), record.status)} accessibilityRole="button" style={styles.bookingRouteButton}><Text style={historyTypography.primaryAction}>{actionLabel}</Text></Pressable></View>
          {canCancel && <PrimaryButton label={isCancelling ? t('login.pleaseWait') : t('rides.cancelRide')} onPress={() => cancel(record.id)} disabled={isCancelling} danger />}
        </View>;
      })}
    </ScrollView>
    <CustomerTabBar active="bookings" onHome={onHome} onBookings={() => undefined} onProfile={onProfile} />
    {detailsRide && <BookingDetailsSheet ride={detailsRide} captain={detailsCaptain} onClose={() => setDetailsRide(null)} onOpenSupport={onOpenSupport} onOpenIssue={onOpenIssue} />}
  </SafeAreaView>;
}

// History previously combined explicit Jakarta faces with legacy fontWeight
// values. Android resolves that combination through the old typeface cache.
// Keep these text styles separate so every History label uses the loaded face.
const historyTypography = StyleSheet.create({
  title: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize['2xl'] },
  empty: { color: colors.textSecondary, fontFamily: fontFamilyMedium, fontSize: fontSize.md, lineHeight: 24 },
  status: { color: colors.primary, fontFamily: fontFamilyBold, fontSize: fontSize.sm },
  route: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.md },
  secondaryAction: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm, textAlign: 'center' },
  primaryAction: { color: colors.textOnPrimary, fontFamily: fontFamilyBold, fontSize: fontSize.sm, textAlign: 'center' },
});

export function CustomerTabBar({ active, onHome, onBookings, onProfile }: { active: 'home' | 'bookings' | 'profile'; onHome: () => void; onBookings: () => void; onProfile: () => void }) {
  const { t } = useTranslation();
  const { bottomInset, tabBarHeight } = useBottomTabBarMetrics();
  return <View style={[styles.homeTabBar, { minHeight: tabBarHeight, paddingBottom: 10 + bottomInset }]}><HomeTab kind="home" label={t('home.tabHome')} active={active === 'home'} onPress={onHome} /><HomeTab kind="rides" label={t('home.tabBookings')} active={active === 'bookings'} onPress={onBookings} /><HomeTab kind="account" label={t('home.tabProfile')} active={active === 'profile'} onPress={onProfile} /></View>;
}

/* ─────────────────────────── STYLES ─────────────────────────── */

const styles = StyleSheet.create({
  introSafe: { flex: 1, backgroundColor: colors.primary },
  introContent: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 32 },
  introBrand: { color: colors.textOnPrimary, fontFamily, fontSize: 46, fontWeight: '900' },
  introFooter: { bottom: 32, color: colors.textOnPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900', left: 24, position: 'absolute', right: 24, textAlign: 'center' },
  authChoiceSafe: { backgroundColor: colors.surface, flex: 1 },
  authChoiceTopBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 14 },
  authChoiceBrand: { color: colors.primary, fontFamily: fontFamilyExtraBold, fontSize: 36, letterSpacing: -1.4 },
  authChoiceLanguageButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 28, height: 56, justifyContent: 'center', width: 56 },
  authChoiceLanguageLabel: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  authChoiceArtworkArea: { overflow: 'hidden' },
  authChoiceArtwork: { height: '100%', width: '100%' },
  authChoicePagination: { alignItems: 'center', flexDirection: 'row', gap: 7, height: 30, justifyContent: 'center' },
  authChoicePaginationDot: { backgroundColor: 'rgba(32, 45, 39, 0.25)', borderRadius: 4, height: 6, width: 6 },
  authChoicePaginationDotActive: { backgroundColor: colors.primary, width: 20 },
  authChoiceContent: { flex: 1, justifyContent: 'flex-end' },
  authChoiceCopy: { gap: 18, paddingBottom: 28, paddingHorizontal: 24 },
  authChoiceTitle: { color: colors.textPrimary, fontFamily, fontSize: 36, fontWeight: '900', letterSpacing: -1.1 },
  authChoiceHelp: { color: colors.textSecondary, fontFamily, fontSize: fontSize.lg, lineHeight: 28, marginBottom: 18 },
  authChoicePrimaryButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.pill, justifyContent: 'center', minHeight: 60, paddingHorizontal: 20 },
  authChoicePrimaryButtonText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' },
  authChoiceSecondaryButton: { alignItems: 'center', borderColor: colors.primaryDark, borderRadius: radii.pill, borderWidth: 2, justifyContent: 'center', minHeight: 60, paddingHorizontal: 20 },
  authChoiceSecondaryButtonText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.lg, fontWeight: '900' },
  authChoiceLegal: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, lineHeight: 19, marginTop: 2 },
  signupDetails: { gap: 8, marginTop: 40 },
  signupLabel: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800', marginTop: 10 },
  signupRequired: { color: colors.error },
  signupOptional: { color: colors.textMuted, fontWeight: '400' },
  signupInput: { borderBottomColor: colors.border, borderBottomWidth: 2, color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, height: 48, paddingHorizontal: 0 },
  signupPhoneRow: { alignItems: 'flex-end', flexDirection: 'row', gap: 16, marginBottom: 2 },
  signupCountryCode: { alignItems: 'center', borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, height: 44, justifyContent: 'center', paddingHorizontal: 14 },
  signupCountryCodeText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  signupPhoneInput: { borderBottomColor: colors.border, borderBottomWidth: 2, color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.lg, height: 48, paddingHorizontal: 0 },
  addressTypes: { flexDirection: 'row', gap: 12, marginTop: 10 },
  addressType: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.primary, borderRadius: radii.pill, borderWidth: 1.5, minWidth: 110, paddingHorizontal: 16, paddingVertical: 10 },
  addressTypeActive: { backgroundColor: colors.primary },
  addressTypeText: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  addressTypeTextActive: { color: colors.textOnPrimary },
  // Map-led customer home
  mapHomeSafe: { flex: 1, backgroundColor: colors.primaryLight },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  modalCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 24, width: '85%', maxWidth: 340, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalEmoji: { fontSize: 48, marginBottom: 16 },
  modalTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900', textAlign: 'center', marginBottom: 10 },
  modalMessage: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalButton: { backgroundColor: colors.primary, borderRadius: radii.pill, paddingVertical: 12, paddingHorizontal: 32, width: '100%', alignItems: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  mapRecenterButton: { height: 48, position: 'absolute', right: 18, width: 48, zIndex: 3 },
  mapGpsButton: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 48, justifyContent: 'center', width: 48 },
  mapGpsButtonPressed: { opacity: 0.72 },
  recenterIcon: { color: colors.primary, fontSize: 29, fontWeight: '800', lineHeight: 32 },
  currentLocationDot: { backgroundColor: colors.primary, borderColor: '#FFFFFF', borderRadius: 13, borderWidth: 4, height: 26, width: 26, ...shadows.card },
  mapFallback: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: radii.pill, left: 20, paddingHorizontal: 14, paddingVertical: 8, position: 'absolute', right: 78, top: 90 },
  mapFallbackText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, textAlign: 'center' },
  locationNotice: { backgroundColor: colors.accentLight, borderColor: '#F6C7B4', borderRadius: radii.md, borderWidth: 1, left: 20, paddingHorizontal: 12, paddingVertical: 9, position: 'absolute', right: 20, top: 92 },
  locationNoticeText: { color: colors.accent, fontFamily, fontSize: fontSize.xs, fontWeight: '700', textAlign: 'center' },
  homeSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, left: 0, overflow: 'hidden', position: 'absolute', right: 0, zIndex: 6 },
  homeSheetLayer: { elevation: 6 },
  sheetHandleArea: { alignItems: 'center', minHeight: 44, paddingBottom: 10, paddingTop: 12 },
  sheetHandle: { backgroundColor: colors.border, borderRadius: radii.pill, height: 5, width: 46 },
  homeSheetHandle: { backgroundColor: colors.textSecondary, borderRadius: radii.pill, height: 5, width: 46 },
  homeSheetGestureArea: { flex: 1 },
  homeSheetScroll: { flex: 1 },
  homeSheetContent: { paddingBottom: 24 },
  homeSheetDynamicContent: { gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  homeSheetBrandWallpaper: { aspectRatio: 1152 / 928, backgroundColor: colors.bg, overflow: 'hidden', width: '100%' },
  homeSheetBrandArtwork: { ...StyleSheet.absoluteFillObject, height: '100%', opacity: 0.22, width: '100%' },
  promotionCard: { backgroundColor: colors.successLight, borderColor: colors.success, borderRadius: radii.md, borderWidth: 1, gap: 3, padding: 12 },
  promotionCardCompact: { padding: 10 },
  promotionTitle: { color: colors.success, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  promotionDetail: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xs, lineHeight: 18 },
  promotionStrip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.success, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: 38, paddingHorizontal: 12, paddingVertical: 7 },
  promotionStripAccent: { color: colors.success, fontSize: 12 },
  promotionStripText: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.xs, fontWeight: '700', lineHeight: 18 },
  offersEmpty: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, marginTop: 32, textAlign: 'center' },
  destinationAction: { backgroundColor: colors.surface, borderColor: colors.primary, borderRadius: radii.lg, borderWidth: 1.5, justifyContent: 'center', minHeight: 76, paddingHorizontal: 18, ...shadows.soft },
  destinationTextWrap: { gap: 3 },
  destinationLabel: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.lg },
  destinationSub: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs },
  recentDestinations: { gap: 2, paddingTop: 2 },
  recentDestinationsEmpty: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20, paddingVertical: 8 },
  recentDestination: { alignItems: 'center', borderBottomColor: colors.divider, borderBottomWidth: 1, flexDirection: 'row', gap: 4, minHeight: 58, paddingVertical: 8 }, recentDestinationMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 4 }, recentBookmark: { alignItems: 'center', height: 44, justifyContent: 'center', width: 42 }, recentBookmarkText: { color: colors.primaryDark, fontSize: 31, lineHeight: 34 }, recentBookmarkSaved: { color: colors.primary },
  recentDestinationIcon: { color: colors.primary, fontSize: 44, lineHeight: 48, width: 44 },
  recentDestinationText: { flex: 1, gap: 1 },
  recentDestinationName: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm },
  recentDestinationAddress: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, lineHeight: 17 },
  recentDestinationChevron: { color: colors.textMuted, fontSize: 25 },
  homeExpandedOnly: { gap: 12 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  homeSectionTitle: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.md },
  homeSectionLink: { color: colors.primary, fontFamily, fontSize: fontSize.xs, fontWeight: '700' },
  landmarkRow: { flexDirection: 'row', gap: 8 },
  landmarkCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, minHeight: 66, opacity: 0.94, paddingHorizontal: 5, paddingTop: 8 },
  landmarkIcon: { color: colors.primary, fontSize: 18, marginBottom: 3 },
  landmarkText: { color: colors.textPrimary, fontFamily, fontSize: 10, lineHeight: 13, textAlign: 'center' },
  homeTabBar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, elevation: 7, flexDirection: 'row', justifyContent: 'space-around', left: 0, paddingTop: 4, position: 'absolute', right: 0, zIndex: 7 },
  homeTab: { alignItems: 'center', flex: 1, gap: 2, justifyContent: 'center', minHeight: 52, minWidth: 0 },
  homeTabLabel: { color: colors.textMuted, fontFamily, fontSize: 12 },
  homeTabLabelActive: { color: colors.primaryDark, fontFamily: fontFamilySemiBold },
  customerTabIconCanvas: { alignItems: 'center', height: 27, justifyContent: 'center', position: 'relative', width: 28 },
  customerTabHomeRoof: { borderLeftWidth: 2, borderTopWidth: 2, height: 15, position: 'absolute', top: 2, transform: [{ rotate: '45deg' }], width: 15 },
  customerTabHomeBody: { borderRadius: 1, borderWidth: 2, bottom: 2, height: 13, position: 'absolute', width: 17 },
  customerTabHomeDoor: { borderLeftWidth: 2, borderRightWidth: 2, borderTopWidth: 2, bottom: 0, height: 7, position: 'absolute', width: 5 },
  customerTabCalendar: { borderRadius: 3, borderWidth: 2, height: 19, left: 2, position: 'absolute', top: 3, width: 18 },
  customerTabCalendarTop: { borderBottomWidth: 2, height: 5, width: '100%' },
  customerTabCalendarDot: { borderRadius: 1, height: 3, left: 5, position: 'absolute', top: 9, width: 3 },
  customerTabClock: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 7, borderWidth: 2, bottom: 1, height: 14, justifyContent: 'center', position: 'absolute', right: 1, width: 14 },
  customerTabClockHand: { height: 5, transform: [{ rotate: '35deg' }], width: 2 },
  customerTabAccountHead: { borderRadius: 5, borderWidth: 2, height: 10, position: 'absolute', top: 2, width: 10 },
  customerTabAccountBody: { borderRadius: 10, borderTopWidth: 2, bottom: 2, height: 10, position: 'absolute', width: 20 },

  // Pickup and destination form
  locationFormIntro: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 22 },
  locationFormCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, overflow: 'hidden' },
  locationField: { alignItems: 'center', flexDirection: 'row', minHeight: 64, paddingHorizontal: 15 },
  locationFieldActive: { backgroundColor: colors.surfaceSecondary },
  locationFieldDot: { alignItems: 'center', backgroundColor: colors.successLight, borderRadius: radii.pill, height: 26, justifyContent: 'center', marginRight: 12, width: 26 },
  locationFieldDotDrop: { backgroundColor: '#F7E2DE' },
  locationFieldDotText: { color: colors.success, fontSize: 14, lineHeight: 18 },
  locationFieldDotTextDrop: { color: '#B7655A' },
  locationFieldTextWrap: { flex: 1 },
  locationFieldLabel: { color: colors.textSecondary, fontFamily: fontFamilySemiBold, fontSize: fontSize.xs },
  locationFieldInput: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.md, minHeight: 34, padding: 0 },
  locationFieldPreview: { alignItems: 'center', flexDirection: 'row', minHeight: 34 },
  locationFieldPreviewText: { color: colors.textPrimary, flex: 1, fontFamily: fontFamilySemiBold, fontSize: fontSize.md },
  locationFieldCaret: { backgroundColor: colors.primaryDark, height: 22, marginLeft: 2, width: 2 },
  locationFieldDivider: { backgroundColor: colors.divider, height: 1, marginLeft: 53 },
  locationQuickActions: { flexDirection: 'row', gap: 10 },
  locationQuickAction: { alignItems: 'center', backgroundColor: colors.primaryLight, borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  locationQuickActionText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.xs, fontWeight: '800', textAlign: 'center' },
  locationResolution: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20, marginTop: 2 },
  locationResolutionFailed: { color: '#B42318', fontWeight: '700' },
  pinPickerHint: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20, marginBottom: 8 },
  pinFallback: { backgroundColor: colors.primaryLight, borderColor: '#BFE8DE', borderRadius: radii.lg, borderWidth: 1, gap: 8, padding: 14 },
  pinFallbackTitle: { color: colors.primaryDark, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  pinFallbackHint: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 21 },

  // Full-screen pin drop: pin is an overlay while the native map moves underneath.
  pinPickerSafe: { flex: 1, backgroundColor: colors.primaryLight },
  fixedPinWrap: { alignItems: 'center', left: 0, marginTop: -25, position: 'absolute', right: 0, top: '42%' },
  fixedPin: { alignItems: 'center', backgroundColor: colors.accent, borderColor: colors.surface, borderRadius: radii.pill, borderWidth: 4, height: 40, justifyContent: 'center', width: 40, ...shadows.card },
  fixedPinText: { color: colors.textOnAccent, fontSize: 16 },
  fixedPinStem: { backgroundColor: colors.accent, height: 18, width: 4 },
  pinPickerBack: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 48, justifyContent: 'center', left: 18, position: 'absolute', top: 28, width: 48 },
  pinPickerGps: { height: 48, position: 'absolute', right: 18, top: 28, width: 48 },
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
  rideOptionsTop: { alignItems: 'center', minHeight: 52, paddingHorizontal: 16, position: 'relative' },
  rideOptionsBack: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 46, justifyContent: 'center', width: 46 },
  rideOptionsBackFloating: { left: 16, position: 'absolute', top: 3, zIndex: 1 },
  rideOptionsBackText: { color: colors.textPrimary, fontSize: 34, lineHeight: 36, marginTop: -4 },
  routeSummary: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 7, height: 48, marginLeft: 50, marginRight: 6, paddingHorizontal: 12 }, routeSummaryPlace: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 5, minWidth: 0 }, routeSummaryDropDot: { color: colors.accent },
  routeSummaryDot: { color: colors.success, fontSize: 15 },
  routeSummaryText: { color: colors.textPrimary, flex: 1, fontFamily: fontFamilySemiBold, fontSize: fontSize.xs },
  routeSummaryArrow: { color: colors.accent, fontSize: 16, fontWeight: '800' },
  rideOptionsBottom: { bottom: 0, left: 0, position: 'absolute', right: 0 },
  searchUnavailableBanner: { alignSelf: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, marginBottom: 8, maxWidth: '90%', paddingHorizontal: 14, paddingVertical: 9 },
  searchUnavailableBannerText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '700', textAlign: 'center' },
  rideOptionsSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, left: 0, overflow: 'hidden', position: 'absolute', right: 0, zIndex: 6 },
  rideOptionsSheetGestureArea: { flex: 1 },
  rideOptionsSheetScroll: { flex: 1 },
  rideOptionsSheetContent: { flexGrow: 1, gap: 12, padding: 16, paddingBottom: 22 },
  rideOptionsHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  rideOptionsHeading: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md },
  rideFareHeading: { color: colors.textMuted, fontFamily: fontFamilySemiBold, fontSize: fontSize.xs, textTransform: 'uppercase' },
  rideOptionList: { gap: 2 },
  rideOptionsExtras: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1 },
  rideOptionsExtrasExpanded: { borderColor: colors.primary, gap: 6, paddingBottom: 8 },
  paymentPreferenceToggle: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', height: 48, justifyContent: 'space-around' },
  rideOptionsFixedActions: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 0, gap: 10, left: 0, paddingHorizontal: 16, paddingTop: 12, position: 'absolute', right: 0, zIndex: 8 },
  bookingActionRow: { flexDirection: 'row', gap: 10 },
  offersToggle: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', height: 48, justifyContent: 'space-around' },
  fullScreenSheetOverlay: { backgroundColor: 'rgba(20, 31, 27, 0.58)', bottom: 0, justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 30 },
  offersSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, gap: 16, minHeight: '54%', padding: 22 },
  modalActionSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, gap: 14, padding: 22 },
  // Android's map and fixed ride controls are elevated native views. Keep the
  // sheet above them inside the native Modal layer on every device.
  modalSheetSurface: { elevation: 12 },
  modalSheetHandle: { alignSelf: 'center', backgroundColor: colors.border, borderRadius: radii.pill, height: 5, width: 48 },
  ratingOverlay: { backgroundColor: 'transparent', bottom: 0, justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0, top: 0 },
  ratingSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, gap: 14, paddingHorizontal: 22, paddingTop: 14 },
  ratingClose: { alignItems: 'center', height: 36, justifyContent: 'center', position: 'absolute', right: 16, top: 14, width: 36, zIndex: 1 },
  ratingCloseText: { color: colors.textSecondary, fontSize: 30, lineHeight: 33 },
  ratingTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xl, fontWeight: '900', textAlign: 'center' },
  ratingSubtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, lineHeight: 24, paddingHorizontal: 24, textAlign: 'center' },
  ratingStars: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingVertical: 4 },
  ratingStar: { color: colors.border, fontSize: 42, lineHeight: 48 },
  ratingStarSelected: { color: '#F59E0B' },
  ratingError: { color: colors.error, fontFamily, fontSize: fontSize.sm, textAlign: 'center' },
  ratingSkip: { alignItems: 'center', minHeight: 38, justifyContent: 'center' },
  ratingSkipText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  offersHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  offersTitle: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.xl },
  offersClose: { color: colors.textPrimary, fontSize: 34, lineHeight: 36 },
  offersLabel: { color: colors.textSecondary, fontFamily: fontFamilySemiBold, fontSize: fontSize.md },
  couponEntry: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  couponInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, flex: 1, fontFamily: fontFamilySemiBold, fontSize: fontSize.md, height: 54, paddingHorizontal: 14 },
  couponApply: { color: colors.primary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.sm },
  couponCard: { backgroundColor: colors.surface, borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, gap: 3, padding: 14 },
  couponTitle: { color: colors.textPrimary, fontFamily: fontFamilyBold, fontSize: fontSize.md }, couponCopy: { color: colors.textSecondary, fontFamily: fontFamilyMedium, fontSize: fontSize.sm }, noCoupons: { color: colors.textSecondary, fontFamily: fontFamilyMedium, fontSize: fontSize.md, paddingVertical: 28, textAlign: 'center' },
  rideOffersButton: { alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 16 },
  rideOptionsExtra: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm },
  rideOptionsExtraChevron: { color: colors.textMuted, fontFamily: fontFamilySemiBold, fontSize: fontSize.lg },
  paymentPreferenceOptions: { gap: 3, paddingHorizontal: 8 },
  paymentPreferenceOption: { alignItems: 'center', borderColor: 'transparent', borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 10, minHeight: 58, paddingHorizontal: 8, paddingVertical: 7 },
  paymentPreferenceOptionSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  paymentPreferenceBadge: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 34, justifyContent: 'center', width: 34 },
  paymentPreferenceUpiBadge: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  paymentPreferenceBadgeText: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm },
  paymentPreferenceCopy: { flex: 1, gap: 1 },
  paymentPreferenceOptionLabel: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm },
  paymentPreferenceOptionDetail: { color: colors.textMuted, fontFamily: fontFamilyMedium, fontSize: fontSize.xs },
  paymentPreferenceRadio: { alignItems: 'center', borderColor: colors.textMuted, borderRadius: radii.pill, borderWidth: 2, height: 20, justifyContent: 'center', width: 20 },
  paymentPreferenceRadioSelected: { borderColor: colors.primary },
  paymentPreferenceRadioDot: { backgroundColor: colors.primary, borderRadius: radii.pill, height: 10, width: 10 },
  rideFareHeadingError: { color: '#B42318' },
  promotionUnavailable: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, lineHeight: 18 },
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
    fontFamily: fontFamilySemiBold,
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
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
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
    fontFamily: fontFamilyExtraBold,
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
  resultsScroll: {
    maxHeight: 240,
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
  resultMarker: { alignItems: 'center', minWidth: 34 },
  resultPin: { fontSize: 18 },
  resultDistance: { color: colors.textSecondary, fontFamily, fontSize: 10, marginTop: 2, textAlign: 'center' },
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
    minHeight: 62,
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
    fontFamily: fontFamilySemiBold,
    fontSize: fontSize.md,
  },
  rideDetail: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.xs,
  },
  rideFare: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.lg },
  rideFareWrap: { alignItems: 'flex-end', gap: 1 },
  rideFareWrapStart: { alignItems: 'flex-start' },
  rideFareStruck: { color: colors.textMuted, fontSize: fontSize.sm, textDecorationLine: 'line-through' },
  rideFareFree: { color: colors.primaryDark, fontFamily: fontFamilyExtraBold, fontSize: fontSize.lg },
  rideOfferApplied: { color: colors.success, fontFamily, fontSize: 10, fontWeight: '800' },
  passengerPicker: { backgroundColor: colors.bgAlt, borderRadius: radii.md, gap: 8, padding: 10 },
  passengerPickerLabel: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  passengerChoices: { flexDirection: 'row', gap: 8 },
  passengerChoice: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.pill, borderWidth: 1, height: 38, justifyContent: 'center', width: 48 },
  passengerChoiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  passengerChoiceText: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  passengerChoiceTextSelected: { color: colors.textOnPrimary },
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
  assignedSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, left: 0, position: 'absolute', right: 0 },
  assignedSheetContent: { gap: 13, padding: 16, paddingBottom: 22 },
  bookingStatus: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  nearbyRideNotice: { backgroundColor: colors.primaryLight, borderRadius: radii.md, gap: 4, padding: 12 },
  nearbyRideNoticeTitle: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '900' },
  nearbyRideNoticeText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 19 },
  assignedHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  assignedTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '800' },
  assignedSubtitle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, marginTop: 3 },
  etaBadge: { backgroundColor: colors.primaryLight, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7 },
  etaBadgeText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  assignedCaptainRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 10 },
  assignedCaptainText: { flex: 1 },
  assignedVehicle: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, marginTop: 2 },
  assignedContact: { flexDirection: 'row', gap: 7 }, assignedCall: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 38, justifyContent: 'center', width: 38 }, assignedCallDisabled: { opacity: 0.45 },
  assignedCallText: { color: colors.primary, fontSize: 20 },
  messageUnreadBadge: { alignItems: 'center', backgroundColor: colors.error, borderColor: colors.surface, borderRadius: 9, borderWidth: 1, justifyContent: 'center', minWidth: 17, paddingHorizontal: 3, position: 'absolute', right: -10, top: -8 },
  messageUnreadBadgeText: { color: colors.surface, fontFamily, fontSize: 10, fontWeight: '900', lineHeight: 15 },
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
  bookingDetailLabelRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' }, supportUnreadBadge: { backgroundColor: colors.error, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 4 }, supportUnreadBadgeText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.xs, fontWeight: '900' }, resolvedIssueSection: { borderColor: '#B9EBC7' },
  bookingDetailTime: { color: colors.primaryDark, fontFamily, fontSize: fontSize.xs, fontWeight: '800', textAlign: 'right' },
  rideIdRow: { backgroundColor: colors.primaryLight, borderRadius: radii.sm, flexDirection: 'row', justifyContent: 'space-between', padding: 10 }, rideIdValue: { color: colors.primaryDark, fontFamily, fontSize: fontSize.xs, fontWeight: '800', maxWidth: '68%' },
  raiseIssueButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: 50 }, raiseIssueButtonText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
  issueChatOverlay: { backgroundColor: colors.bg, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0, zIndex: 40 }, issueChatSafe: { flex: 1 }, issueChatContent: { gap: 14, padding: 20 }, issueChatRide: { alignSelf: 'center', backgroundColor: colors.surfaceSecondary, borderRadius: radii.pill, color: colors.textSecondary, fontFamily: fontFamilyMedium, fontSize: fontSize.xs, paddingHorizontal: 12, paddingVertical: 6 }, botBubble: { alignSelf: 'flex-start', backgroundColor: colors.surfaceSecondary, borderRadius: radii.md, maxWidth: '86%', padding: 13 }, customerBubble: { alignSelf: 'flex-end', backgroundColor: colors.primaryLight, borderRadius: radii.md, maxWidth: '86%', padding: 13 }, botBubbleText: { color: colors.textPrimary, fontFamily: fontFamilyMedium, fontSize: fontSize.sm, lineHeight: 21 }, issueChatPrompt: { color: colors.textSecondary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, marginTop: 4 }, issueChoice: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: 15, paddingVertical: 14 }, issueChoiceText: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm }, issueNoteInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, color: colors.textPrimary, fontFamily: fontFamilyMedium, minHeight: 108, padding: 13, textAlignVertical: 'top' },
  assignedPickupText: { color: colors.textPrimary, flex: 1, fontFamily: fontFamilySemiBold, fontSize: fontSize.md, lineHeight: 23 }, assignedDropDot: { backgroundColor: colors.accent }, editLocation: { color: colors.primary, fontSize: 28, fontWeight: '800' },
  bookingsSafe: { backgroundColor: colors.bg, flex: 1 }, bookingsContent: { gap: 16, padding: 20 }, bookingsTitle: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize['2xl'] }, bookingsPeriod: { color: colors.primaryDark, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm, marginTop: -8 }, bookingsEmpty: { color: colors.textSecondary, fontFamily: fontFamilyMedium, fontSize: fontSize.md, lineHeight: 24 }, bookingCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 8, padding: 18 }, bookingCardStatus: { color: colors.primary, fontFamily: fontFamilyBold, fontSize: fontSize.sm }, bookingCardRoute: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.md }, bookingCardArrow: { color: colors.textMuted, fontSize: 20 }, bookingCardActions: { flexDirection: 'row', gap: 10, marginTop: 8 }, bookingDetailsButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 8 }, bookingDetailsButtonText: { color: colors.primaryDark, fontFamily: fontFamilyBold, fontSize: fontSize.sm, textAlign: 'center' }, bookingRouteButton: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: radii.md, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 8 }, bookingRouteButtonText: { color: colors.textOnPrimary, fontFamily: fontFamilyBold, fontSize: fontSize.sm, textAlign: 'center' }, bookingDetailsOverlay: { backgroundColor: 'rgba(23, 26, 24, 0.58)', bottom: 0, justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 20 }, bookingDetailsSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, gap: 16, maxHeight: '90%', paddingHorizontal: 20, paddingTop: 14 }, bookingDetailsHero: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: radii.lg, flexDirection: 'row', gap: 11, padding: 14 }, bookingDetailsHeroIcon: { alignItems: 'center', backgroundColor: colors.surfaceMint, borderRadius: radii.pill, height: 46, justifyContent: 'center', width: 46 }, bookingDetailsHeroIconText: { fontSize: 23 }, bookingDetailsHeroText: { flex: 1, gap: 3 }, bookingDetailsTitle: { color: colors.textOnPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.lg }, bookingDetailsClose: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radii.pill, height: 34, justifyContent: 'center', width: 34 }, bookingDetailsCloseText: { color: colors.textOnPrimary, fontSize: 27, lineHeight: 30 }, bookingDetailsContent: { gap: 12, paddingBottom: 2 }, bookingDetailsStatus: { alignSelf: 'flex-start', backgroundColor: colors.surfaceMint, borderRadius: radii.pill, color: colors.primaryDark, fontFamily: fontFamilySemiBold, fontSize: fontSize.xs, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4 }, bookingDetailsSection: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: 10, padding: 14 }, bookingHelpActions: { flexDirection: 'row', gap: 10 }, bookingDetailsSectionTitle: { color: colors.textPrimary, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md }, bookingDetailRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 }, bookingDetailDivider: { backgroundColor: colors.divider, height: 1, marginLeft: 20 }, bookingDetailText: { flex: 1 }, bookingDetailLabel: { color: colors.textSecondary, fontFamily: fontFamilyMedium, fontSize: fontSize.sm, lineHeight: 20 }, bookingDetailValue: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.md, lineHeight: 22 }, bookingDetailAmount: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, bookingFareGrid: { flexDirection: 'row', gap: 10 }, bookingFareTile: { backgroundColor: colors.primaryLight, borderRadius: radii.sm, flex: 1, gap: 3, padding: 11 }, bookingDetailAmountValue: { color: colors.primaryDark, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md }, bookingCaptainRow: { alignItems: 'center', flexDirection: 'row', gap: 10 }, bookingCaptainAvatar: { alignItems: 'center', backgroundColor: colors.accentLight, borderRadius: radii.pill, height: 42, justifyContent: 'center', width: 42 }, bookingCaptainAvatarText: { fontSize: 20 }, bookingDetailLoading: { color: colors.textSecondary, fontFamily: fontFamilyMedium, fontSize: fontSize.sm }, bookingRatingRow: { alignItems: 'center', flexDirection: 'row', gap: 10 }, bookingRating: { color: '#F59E0B', fontSize: 27, letterSpacing: 2 }, bookingRatingNumber: { color: colors.primaryDark, fontFamily: fontFamilyExtraBold, fontSize: fontSize.md },
  bookingRouteStack: { flexDirection: 'row', gap: 10 }, bookingRouteMarker: { alignItems: 'center', paddingTop: 5, width: 12 }, bookingPickupDot: { backgroundColor: colors.primary, borderRadius: 4, height: 8, width: 8 }, bookingRouteLine: { backgroundColor: colors.border, flex: 1, marginVertical: 3, width: 2 }, bookingDropDot: { borderColor: colors.accent, borderRadius: 4, borderWidth: 2, height: 8, width: 8 }, bookingRouteText: { flex: 1, gap: 9 },
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
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 0,
  },
  summaryRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    padding: 14,
  },
  summaryRowDivider: { borderBottomColor: colors.divider, borderBottomWidth: 1 },
  summaryIcon: { fontSize: 20, marginTop: 2 },
  summaryVehicleIcon: { alignItems: 'center', height: 28, justifyContent: 'center', marginTop: 1, width: 28 },
  summaryLocationIcon: { alignItems: 'center', backgroundColor: colors.successLight, borderRadius: radii.pill, height: 26, justifyContent: 'center', marginTop: 1, width: 26 },
  summaryLocationIconDrop: { backgroundColor: '#F7E2DE' },
  summaryLocationIconText: { color: colors.success, fontSize: 14, lineHeight: 18 },
  summaryLocationIconTextDrop: { color: '#B7655A' },
  summaryText: { flex: 1, gap: 3 },
  summaryLabel: {
    color: colors.textMuted,
    fontFamily: fontFamilySemiBold,
    fontSize: fontSize.xs,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: colors.textPrimary,
    fontFamily: fontFamilyExtraBold,
    fontSize: fontSize.lg,
  },
  bookingRouteRecovery: { alignItems: 'center', backgroundColor: colors.bg, flex: 1, justifyContent: 'center' },

  // Searching
  searchingScreen: { backgroundColor: colors.primaryLight, flex: 1 },
  searchingMapDim: { backgroundColor: 'rgba(23, 26, 24, 0.08)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  searchingSafe: { flex: 1 },
  searchingHeader: { alignItems: 'center', backgroundColor: 'rgba(255, 255, 255, 0.94)', borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', minHeight: 52, paddingHorizontal: 20 },
  searchingBackButton: { minWidth: 64 },
  searchingBackText: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: fontSize.sm },
  searchingHeaderTitle: { color: colors.textPrimary, flex: 1, fontFamily: fontFamilySemiBold, fontSize: fontSize.md, textAlign: 'center' },
  searchingHeaderSpacer: { minWidth: 64 },
  searchingHeartbeat: { alignItems: 'center', backgroundColor: 'rgba(25, 135, 84, 0.08)', borderColor: 'rgba(25, 135, 84, 0.82)', borderRadius: 145, borderWidth: 2.5, height: 290, justifyContent: 'center', position: 'absolute', width: 290 },
  searchingHeartbeatInner: { borderColor: 'rgba(25, 135, 84, 0.54)', borderRadius: 98, borderWidth: 1.5, height: 196, width: 196 },
  searchingCaptainMarker: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.primary, borderRadius: radii.pill, borderWidth: 2, height: 38, justifyContent: 'center', width: 38, ...shadows.card },
  searchingPanel: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 7, left: 20, paddingHorizontal: 18, paddingVertical: 14, position: 'absolute', right: 20 },
  searchingLoopIndicator: { alignItems: 'center', height: 32, justifyContent: 'center', width: 108 },
  searchingLoopItem: { alignItems: 'center', height: 32, justifyContent: 'center', position: 'absolute', width: 108 },
  searchingNandyalMark: { color: colors.textPrimary, fontFamily: fontFamilySemiBold, fontSize: 17, includeFontPadding: false, lineHeight: 21, textAlign: 'center' },
  searchingTitle: {
    color: colors.textPrimary,
    fontFamily: fontFamilyExtraBold,
    fontSize: fontSize.lg,
    textAlign: 'center',
  },
  searchingSubtitle: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: fontSize.sm,
    lineHeight: 21,
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
