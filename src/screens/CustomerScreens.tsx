import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Image,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../components/PrimaryButton';
import { useDialog } from '../components/ThemedDialog';
import { ScreenShell } from '../components/ScreenShell';
import { PhoneOtpAuth } from '../components/PhoneOtpAuth';
import { customerAuthService } from '../services/customerAuth';
import { rideCreationService, type CancellationReason } from '../services/rideCreation';
import { rideDispatchService, type AssignedCaptainDetails, type CustomerPromotionStatus, type DispatchRide, type RideStatus } from '../services/rideDispatch';
import { googleMapsService, type PlaceSuggestion } from '../services/googleMaps';
import { offlineLocationCatalogue, type OfflineLocation } from '../services/offlineLocationCatalogue';
import { decodeGooglePolyline } from '../utils/polyline';
import { calculateFare } from '../services/fareEngine';
import { straightLineDistanceMeters } from '../services/distanceProvider';
import { LiveLocationMap, LiveLocationMarker } from '../components/LiveLocationMap';
import { CustomerRideSettlement } from './CustomerRideSettlement';
import { formatFare, formatNumber, formatOtp } from '../utils/format';
import { filterAndSortRideHistory, rideHistoryPeriodLabel, type RideHistoryFilter } from '../utils/rideHistory';
import { RideHistoryFilterControl } from '../components/RideHistoryFilter';
import { colors, radii, shadows, fontFamily, fontSize } from '../theme';

const sawaariHomeFooter = require('../../assets/images/sawaari-brand-nandyal.png');

export type RideKind = 'bike' | 'auto';
export type Coordinate = { latitude: number; longitude: number };
export type RouteQuote = { id: string; distanceMeters: number; durationSeconds: number; encodedPolyline: string };
export type CustomerRide = { id?: string; pickup: string; drop: string; kind: RideKind; passengerCount: number; pickupCoordinate?: Coordinate; dropCoordinate?: Coordinate; routeQuote?: RouteQuote };
type LocationTarget = 'pickup' | 'drop';
type CustomerFareDisplay = { originalEstimatedFare: number | null; customerCharge: number | null; finalFare: number | null; routeDistanceMeters: number | null; isFree: boolean; promotionAvailable: boolean };
const NANDYAL: Region = { latitude: 15.4889, longitude: 78.4836, latitudeDelta: 0.035, longitudeDelta: 0.035 };
const estimateCoordinateDistanceKm = (a: Coordinate, b: Coordinate) => Math.sqrt((a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2) * 111;

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
}: {
  onComplete: () => void;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  return <PhoneOtpAuth title={t('screens.customerLogin')} subtitle={t('login.subtitle')} emoji="📱" onBack={onBack} onSendOtp={customerAuthService.sendOtp} onVerifyOtp={async (phone, otp) => { await customerAuthService.verifyOtp(phone, otp); onComplete(); }} />;
}

/* ─────────────────────────── HOME ─────────────────────────── */

export function CustomerHomeScreen({
  ride,
  onPickLocation,
  onStartBooking,
  onPickupHere,
  onBookings,
  hasActiveRide,
  onProfile,
  onBack,
}: {
  ride: CustomerRide;
  onPickLocation: (target: LocationTarget) => void;
  onStartBooking: (pickup: string, coordinate: Coordinate) => void;
  onPickupHere: (pickup: string, coordinate: Coordinate) => void;
  onBookings: () => void;
  hasActiveRide: boolean;
  onProfile: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const mapRef = useRef<MapView>(null);
  const sheetHeight = Math.min(520, Dimensions.get('window').height * 0.62);
  const collapsedOffset = Math.max(142, sheetHeight - 278);
  const sheetOffset = useSharedValue(collapsedOffset);
  const sheetDragStart = useSharedValue(collapsedOffset);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [userLocation, setUserLocation] = useState<Coordinate | null>(null);
  const [cachedAddress, setCachedAddress] = useState('');
  const [locationUnavailable, setLocationUnavailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [pickupMarkerReset, setPickupMarkerReset] = useState(0);
  const [promotion, setPromotion] = useState<CustomerPromotionStatus | null>(null);
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
        mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.018, longitudeDelta: 0.018 }, 450);
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

  const setSheet = (expanded: boolean) => {
    setSheetExpanded(expanded);
    sheetOffset.value = withSpring(expanded ? 0 : collapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
  };

  const sheetAnimatedStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetOffset.value }] }));
  const mapRecenterFloatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetOffset.value }] }));
  const sheetPanGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onBegin(() => { sheetDragStart.value = sheetOffset.value; })
    .onUpdate((event) => { sheetOffset.value = clamp(sheetDragStart.value + event.translationY, 0, collapsedOffset); })
    .onEnd((event) => {
      const expand = event.velocityY < -350 || (event.velocityY <= 350 && sheetOffset.value < collapsedOffset / 2);
      sheetOffset.value = withSpring(expand ? 0 : collapsedOffset, { damping: 24, stiffness: 260, mass: 0.7 });
      runOnJS(setSheetExpanded)(expand);
    }), [collapsedOffset, sheetDragStart, sheetOffset]);

  const landmarks = [
    { icon: '🚌', label: t('home.landmarkBusStand'), target: 'drop' as const },
    { icon: '🚉', label: t('home.landmarkRailway'), target: 'drop' as const },
    { icon: '✚', label: t('home.landmarkHospital'), target: 'drop' as const },
  ];

  const handlePickLocation = (target: LocationTarget) => {
    onPickLocation(target);
  };

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
      mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 350);
      void reverseGeocodeAddress(coordinate, t('location.gpsDefault')).then(setCachedAddress);
    } catch { setLocationUnavailable(true); }
  };
  const pickupHere = async (coordinate: Coordinate) => {
    if (hasActiveRide) { onBookings(); return; }
    onPickupHere(await reverseGeocodeAddress(coordinate, t('location.gpsDefault')), coordinate);
  };
  return (
    <SafeAreaView style={styles.mapHomeSafe} edges={['top', 'left', 'right']}>
      <LiveLocationMap mapRef={mapRef} location={userLocation} onMapReady={() => setMapReady(true)} pickupHereLabel={t('home.pickupHere')} onPickupHere={userLocation ? pickupHere : undefined} locationResetToken={pickupMarkerReset} />

      {!mapReady && <View style={styles.mapFallback}><Text style={styles.mapFallbackText}>{t('home.mapLoading')}</Text></View>}
      {locationUnavailable && <View style={styles.locationNotice}><Text style={styles.locationNoticeText}>{t('home.locationUnavailable')}</Text></View>}

      <GestureDetector gesture={sheetPanGesture}>
        <Reanimated.View style={[styles.homeSheet, { height: sheetHeight }, sheetAnimatedStyle, shadows.card, styles.homeSheetLayer]}>
          <Image accessibilityIgnoresInvertColors resizeMode="cover" source={sawaariHomeFooter} style={styles.homeSheetBackdrop} />
          <Pressable onPress={() => setSheet(!sheetExpanded)} style={styles.sheetHandleArea} accessibilityRole="button" accessibilityLabel={t('home.toggleSheet')}>
            <View style={styles.sheetHandle} />
          </Pressable>
          <ScrollView contentContainerStyle={styles.homeSheetContent} showsVerticalScrollIndicator={false} style={styles.homeSheetScroll}>
            <PromotionOfferCard promotion={promotion} t={t} />
            <Pressable onPress={startBooking} accessibilityRole="button" style={styles.destinationAction}>
              <Text style={styles.destinationPin}>⌖</Text><View style={styles.destinationTextWrap}><Text style={styles.destinationLabel}>{t('home.whereTo')}</Text><Text style={styles.destinationSub}>{t('home.whereToHint')}</Text></View><Text style={styles.destinationArrow}>→</Text>
            </Pressable>
            <View style={styles.savedRow}>
              <SavedPlace icon="⌂" label={t('home.home')} sublabel={t('home.savedPlaceHint')} onPress={() => handlePickLocation('pickup')} />
              <SavedPlace icon="▣" label={t('home.work')} sublabel={t('home.savedPlaceHint')} onPress={() => handlePickLocation('pickup')} />
            </View>
            <View style={styles.homeExpandedOnly}>
              <View style={styles.sectionHeading}><Text style={styles.homeSectionTitle}>{t('home.nearby')}</Text><Text style={styles.homeSectionLink} onPress={() => handlePickLocation('drop')}>{t('home.seeAll')}</Text></View>
              <View style={styles.landmarkRow}>{landmarks.map((landmark) => <Pressable key={landmark.label} accessibilityRole="button" onPress={() => handlePickLocation(landmark.target)} style={styles.landmarkCard}><Text style={styles.landmarkIcon}>{landmark.icon}</Text><Text style={styles.landmarkText} numberOfLines={2}>{landmark.label}</Text></Pressable>)}</View>
            </View>
          </ScrollView>
        </Reanimated.View>
      </GestureDetector>
      <Reanimated.View style={[styles.mapRecenterButton, { bottom: sheetHeight + 88 }, mapRecenterFloatStyle]}>
        <Pressable onPress={centerOnLocation} accessibilityRole="button" accessibilityLabel={t('home.recenter')} style={StyleSheet.absoluteFill}><Text style={styles.mapRecenterIcon}>⌖</Text></Pressable>
      </Reanimated.View>
      <View style={styles.homeTabBar}>
        <HomeTab icon="⌂" label={t('home.tabHome')} active />
        <HomeTab icon="▤" label={t('home.tabBookings')} onPress={onBookings} />
        <HomeTab icon="?" label={t('home.tabHelp')} onPress={() => dialog({ title: t('home.helpTitle'), message: t('home.helpMessage') })} />
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
  const [liveSuggestions, setLiveSuggestions] = useState<PlaceSuggestion[]>([]);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  const placesSessionToken = useRef(newPlacesSessionToken());
  const autocompleteSeq = useRef(0);
  const pickupInput = useRef<TextInput>(null);
  const dropInput = useRef<TextInput>(null);
  const query = drafts[target];
  const ready = resolution.pickup === 'located' && resolution.drop === 'located';
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

  useEffect(() => {
    requestAnimationFrame(() => (initialTarget === 'pickup' ? pickupInput : dropInput).current?.focus());
  }, [initialTarget]);

  const setDraft = (nextTarget: LocationTarget, value: string) => {
    setTarget(nextTarget);
    setDrafts((current) => ({ ...current, [nextTarget]: value }));
    setResolution((current) => ({ ...current, [nextTarget]: 'unresolved' }));
    // Text alone must never retain a previous pin or route quote.
    onChange(nextTarget, value, undefined);
  };

  const choosePlace = (place: string, coordinate?: Coordinate, placeTarget: LocationTarget = target) => {
    if (!coordinate) {
      setResolution((current) => ({ ...current, [placeTarget]: 'failed' }));
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDrafts((current) => ({ ...current, [placeTarget]: place }));
    setResolution((current) => ({ ...current, [placeTarget]: 'located' }));
    onChange(placeTarget, place, coordinate);
    if (placeTarget === 'pickup') {
      setTarget('drop');
      requestAnimationFrame(() => dropInput.current?.focus());
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
      choosePlace(details.address || suggestion.text, details.coordinate, selectedTarget);
    } catch (error) {
      console.warn('[place-details] lookup failed', error);
      setResolution((current) => ({ ...current, [selectedTarget]: 'failed' }));
    }
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
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
  }, [query, target]);

  const renderSuggestions = () => {
    if (!focused || !hasCatalogueQuery) return null;
    if (liveSuggestions.length === 0 && shown.length === 0) return null;
    const liveRows = liveSuggestions.map((suggestion, i) => (
      <Pressable key={suggestion.placeId} onPress={() => void selectSuggestion(suggestion)} style={[styles.resultRow, i < liveSuggestions.length - 1 && styles.resultRowDivider]}>
        <Text style={styles.resultPin}>📍</Text><Text style={styles.resultText} numberOfLines={2}>{suggestion.text}</Text>
      </Pressable>
    ));
    const catalogueRows = shown.map((place, i) => {
      const label = place.labelKey ? t(`location.${place.labelKey}`) : place.label;
      return (
        <Pressable key={place.id} onPress={() => { setCataloguePin(place); setPinMode(true); }} style={[styles.resultRow, i < shown.length - 1 && styles.resultRowDivider]}>
          <Text style={styles.resultPin}>📍</Text><Text style={styles.resultText} numberOfLines={2}>{label}</Text>
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
      void reverseGeocodeAddress(coordinate, t('location.gpsDefault')).then((address) => {
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
            onFocus={() => { setTarget('pickup'); setFocused(true); }}
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
            onFocus={() => { setTarget('drop'); setFocused(true); }}
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

function LocationField({ inputRef, active, icon, label, value, placeholder, onFocus, onBlur, onChangeText, onSubmitEditing, drop }: {
  inputRef: React.RefObject<TextInput | null>; active: boolean; icon: string; label: string; value: string; placeholder: string; onFocus: () => void; onBlur: () => void; onChangeText: (value: string) => void; onSubmitEditing: () => void; drop?: boolean;
}) {
  return <View style={[styles.locationField, active && styles.locationFieldActive]}><View style={[styles.locationFieldDot, drop && styles.locationFieldDotDrop]}><Text style={[styles.locationFieldDotText, drop && styles.locationFieldDotTextDrop]}>{icon}</Text></View><View style={styles.locationFieldTextWrap}><Text style={styles.locationFieldLabel}>{label}</Text><TextInput ref={inputRef} value={value} onFocus={onFocus} onBlur={onBlur} onChangeText={onChangeText} onSubmitEditing={onSubmitEditing} placeholder={placeholder} placeholderTextColor={colors.textMuted} style={styles.locationFieldInput} returnKeyType="done" /></View></View>;
}

function PinDropPicker({ target, initialCoordinate, initialAddress, requiresManualPin, onBack, onConfirm }: { target: LocationTarget; initialCoordinate?: Coordinate; initialAddress?: string; requiresManualPin?: boolean; onBack: () => void; onConfirm: (address: string, coordinate: Coordinate) => void }) {
  const { t } = useTranslation();
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
      provider={PROVIDER_GOOGLE}
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
    <Pressable accessibilityRole="button" accessibilityLabel={t('home.recenter')} disabled={gpsLoading} onPress={() => { void centerOnCurrentLocation(); }} style={[styles.pinPickerGps, shadows.card]}><Text style={styles.recenterIcon}>⌖</Text></Pressable>
    <View style={[styles.pinPickerSheet, shadows.card]}>
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
  onRouteQuote,
  onNext,
  onBack,
  onEditLocation,
  unavailableMessage,
  onUnavailableMessageHidden,
}: {
  ride: CustomerRide;
  selected: RideKind;
  onSelect: (kind: RideKind) => void;
  onPassengerCountChange: (count: number) => void;
  onRouteQuote: (quote: RouteQuote) => void;
  onNext: () => void;
  onBack: () => void;
  onEditLocation: (target: LocationTarget) => void;
  unavailableMessage?: string;
  onUnavailableMessageHidden: () => void;
}) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const pickupCoordinate = ride.pickupCoordinate ?? locationCoordinate(ride.pickup, 0);
  const dropCoordinate = ride.dropCoordinate ?? locationCoordinate(ride.drop, 1);
  const [routeQuote, setRouteQuote] = useState<RouteQuote | undefined>(ride.routeQuote);
  const [routeLoading, setRouteLoading] = useState(!hasUsableRouteQuote(ride.routeQuote));
  const [routeError, setRouteError] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<CustomerPromotionStatus | null>(null);
  const encodedPolyline = typeof routeQuote?.encodedPolyline === 'string' ? routeQuote.encodedPolyline : '';
  const routeCoordinates = decodeGooglePolyline(encodedPolyline);
  const hasValidRouteQuote = hasUsableRouteQuote(routeQuote);

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
    const timer = setTimeout(() => mapRef.current?.fitToCoordinates(routeCoordinates, { animated: true, edgePadding: { top: 34, right: 34, bottom: 34, left: 34 } }), 100);
    return () => clearTimeout(timer);
  }, [routeQuote?.id]);
  useEffect(() => { void rideDispatchService.getCustomerPromotionStatus().then(setPromotion).catch(() => setPromotion(null)); }, []);
  useEffect(() => {
    if (!unavailableMessage) return;
    const timer = setTimeout(onUnavailableMessageHidden, 5_000);
    return () => clearTimeout(timer);
  }, [onUnavailableMessageHidden, unavailableMessage]);
  const selectedFareDisplay = getCustomerFareDisplay({ kind: selected, passengerCount: ride.passengerCount, routeQuote, promotion });
  const promotionUnavailable = Boolean(promotion?.promotion_enabled && promotion.remaining_free_rides > 0 && hasValidRouteQuote && !selectedFareDisplay.promotionAvailable);
  const options: Array<{ kind: RideKind; icon: string; fareDisplay: CustomerFareDisplay; eta: number }> = [
    { kind: 'bike', icon: '🏍️', fareDisplay: getCustomerFareDisplay({ kind: 'bike', passengerCount: 1, routeQuote, promotion }), eta: 3 },
    { kind: 'auto', icon: '🛺', fareDisplay: getCustomerFareDisplay({ kind: 'auto', passengerCount: ride.passengerCount, routeQuote, promotion }), eta: 5 },
  ];

  return <SafeAreaView style={styles.rideOptionsSafe} edges={['top', 'left', 'right']}>
    <MapView ref={mapRef} provider={PROVIDER_GOOGLE} initialRegion={NANDYAL} style={StyleSheet.absoluteFill}>
      <Marker coordinate={pickupCoordinate} pinColor={colors.success} title={t('rides.pickup')} />
      <Marker coordinate={dropCoordinate} pinColor={colors.accent} title={t('rides.drop')} />
      {routeCoordinates.length > 1 && <Polyline coordinates={routeCoordinates} strokeColor={colors.primaryDark} strokeWidth={5} />}
    </MapView>
    <View style={styles.rideOptionsTop}>
      <Pressable onPress={onBack} accessibilityRole="button" style={[styles.rideOptionsBack, styles.rideOptionsBackFloating, shadows.soft]}><Text style={styles.rideOptionsBackText}>‹</Text></Pressable>
      <View style={[styles.routeSummary, shadows.soft]}><Pressable onPress={() => onEditLocation('pickup')} accessibilityRole="button" style={styles.routeSummaryPlace}><Text style={styles.routeSummaryDot}>●</Text><Text style={styles.routeSummaryText} numberOfLines={1}>{ride.pickup}</Text></Pressable><Text style={styles.routeSummaryArrow}>→</Text><Pressable onPress={() => onEditLocation('drop')} accessibilityRole="button" style={styles.routeSummaryPlace}><Text style={[styles.routeSummaryDot, styles.routeSummaryDropDot]}>●</Text><Text style={styles.routeSummaryText} numberOfLines={1}>{ride.drop}</Text></Pressable></View>
    </View>
      <View style={[styles.rideOptionsSheet, shadows.card]}>
        <View style={styles.sheetHandle} />
        {unavailableMessage && <Text style={styles.promotionUnavailable}>{unavailableMessage}</Text>}
        <PromotionOfferCard promotion={promotion} t={t} compact />
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
      {promotionUnavailable && <Text style={styles.promotionUnavailable}>{selectedFareDisplay.routeDistanceMeters != null && selectedFareDisplay.routeDistanceMeters > promotion!.maximum_free_distance_meters ? t('rides.freeOfferDistanceUnavailable', { distance: promotion!.maximum_free_distance_meters / 1000 }) : t('rides.freeOfferUsedUnavailable')}</Text>}
      {selected === 'auto' && <View style={styles.passengerPicker}><Text style={styles.passengerPickerLabel}>{t('rides.autoPassengers')}</Text><View style={styles.passengerChoices}>{[1, 2, 3].map((count) => <Pressable key={count} onPress={() => onPassengerCountChange(count)} accessibilityRole="button" accessibilityState={{ selected: ride.passengerCount === count }} style={[styles.passengerChoice, ride.passengerCount === count && styles.passengerChoiceSelected]}><Text style={[styles.passengerChoiceText, ride.passengerCount === count && styles.passengerChoiceTextSelected]}>{formatNumber(count)}</Text></Pressable>)}</View></View>}
      <View style={styles.rideOptionsExtras}><Text style={styles.rideOptionsExtra}>₹ {t('rides.cash')}</Text><View style={styles.rideOptionsDivider} /><Text style={styles.rideOptionsExtra}>{t('rides.offers')}</Text></View>
      <PrimaryButton label={t('rides.bookSelected', { ride: t(`rides.${selected}`) })} onPress={onNext} disabled={!hasValidRouteQuote || routeLoading} />
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
  option: { kind: RideKind; icon: string; fareDisplay: CustomerFareDisplay; eta: number };
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

function PromotionOfferCard({ promotion, t, compact = false }: { promotion: CustomerPromotionStatus | null; t: (key: string, options?: Record<string, unknown>) => string; compact?: boolean }) {
  if (!promotion?.promotion_enabled || promotion.remaining_free_rides <= 0) return null;
  return <View style={[styles.promotionCard, compact && styles.promotionCardCompact]}><Text style={styles.promotionTitle}>{t('rides.freeOfferActive')}</Text><Text style={styles.promotionDetail}>{t('rides.freeOfferSummary', { remaining: promotion.remaining_free_rides, maximum: promotion.maximum_free_rides, distance: promotion.maximum_free_distance_meters / 1000 })}</Text></View>;
}

function CustomerFareValue({ display, t, alignStart = false }: { display: CustomerFareDisplay; t: (key: string) => string; alignStart?: boolean }) {
  return <View style={[styles.rideFareWrap, alignStart && styles.rideFareWrapStart]}>{display.isFree && display.originalEstimatedFare != null ? <><Text style={[styles.rideFare, styles.rideFareStruck]}>{formatFare(display.originalEstimatedFare)}</Text><Text style={styles.rideFareFree}>{t('rides.freeRideAmount')}</Text><Text style={styles.rideOfferApplied}>{t('rides.freeOfferApplied')}</Text></> : <Text style={styles.rideFare}>{display.customerCharge == null ? '—' : formatFare(display.customerCharge)}</Text>}</View>;
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
  const dialog = useDialog();
  const routeQuote = hasUsableRouteQuote(ride.routeQuote) ? ride.routeQuote : undefined;
  const [booking, setBooking] = useState(false);
  const [promotion, setPromotion] = useState<CustomerPromotionStatus | null>(null);
  useEffect(() => { void rideDispatchService.getCustomerPromotionStatus().then(setPromotion).catch(() => setPromotion(null)); }, []);
  const fareDisplay = getCustomerFareDisplay({ kind: ride.kind, passengerCount: ride.passengerCount, routeQuote, promotion });
  const book = async () => {
    if (!routeQuote) {
      dialog({ title: t('rides.routeUnavailable') });
      return;
    }
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
      await onBook(createdRide.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      dialog({ title: message.includes('Route quote expired') ? 'Route expired. Go back and refresh the route before booking.' : t('login.tryAgain') });
    } finally {
      setBooking(false);
    }
  };
  return (
    <ScreenShell back={onBack} title={t('screens.bookingConfirm')}>
      <View style={[styles.summaryCard, shadows.card]}>
        <SummaryRow label={t('rides.pickup')} value={ride.pickup} icon="●" locationTone="pickup" />
        <SummaryRow label={t('rides.drop')} value={ride.drop} icon="●" locationTone="drop" />
        <SummaryRow label={t('rides.ride')} value={t(`rides.${ride.kind}`)} icon={ride.kind === 'bike' ? '🏍️' : '🛺'} />
        {ride.kind === 'auto' && <SummaryRow label={t('rides.passengers')} value={formatNumber(ride.passengerCount)} icon="👤" />}
        <View style={[styles.summaryRow, styles.summaryRowDivider]}><Text style={styles.summaryIcon}>💰</Text><View style={styles.summaryText}><Text style={styles.summaryLabel}>{t('rides.estimate')}</Text><CustomerFareValue display={fareDisplay} t={t} alignStart /></View></View>
      </View>
      <PrimaryButton label={booking ? t('login.pleaseWait') : t('rides.book')} onPress={() => { void book(); }} disabled={booking} />
    </ScreenShell>
  );
}

function SummaryRow({
  label,
  value,
  icon,
  locationTone,
  last,
}: {
  label: string;
  value: string;
  icon: string;
  locationTone?: 'pickup' | 'drop';
  last?: boolean;
}) {
  return (
    <View style={[styles.summaryRow, !last && styles.summaryRowDivider]}>
      {locationTone ? <View style={[styles.summaryLocationIcon, locationTone === 'drop' && styles.summaryLocationIconDrop]}><Text style={[styles.summaryLocationIconText, locationTone === 'drop' && styles.summaryLocationIconTextDrop]}>{icon}</Text></View> : <Text style={styles.summaryIcon}>{icon}</Text>}
      <View style={styles.summaryText}>
        <Text style={styles.summaryLabel}>{label}</Text>
        <Text style={styles.summaryValue}>{value}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────── SEARCHING ─────────────────────────── */

export function SearchingScreen({ rideId, onFound, onBack, onUnavailable, onCancel, onHome, onBookings, onProfile }: { rideId?: string; onFound: () => void; onBack: () => void; onUnavailable?: () => void; onCancel: () => void; onHome: () => void; onBookings: () => void; onProfile: () => void }) {
  const { t } = useTranslation();
  const dialog = useDialog();
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
  const confirmCancel = () => dialog({
    title: t('rides.searchingCancelTitle'),
    message: t('rides.searchingCancelMessage'),
    buttons: [
      { text: t('rides.stay'), style: 'cancel' },
      {
        text: t('rides.confirmCancel'), style: 'destructive', onPress: () => {
          if (!rideId || rideId.startsWith('local-')) return onCancel();
          void rideCreationService.cancel(rideId, 'change_plans').then(onCancel).catch(() => dialog({ title: t('login.tryAgain') }));
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

  return <View style={{ flex: 1 }}>
    <ScreenShell back={confirmCancel} title={t('rides.searchingTitle')}>
      <View style={styles.searchingCenter}>
        <View style={styles.searchingRingWrap}>
          <Animated.View style={[styles.searchingRing, { transform: [{ rotate }] }]} />
          <Text style={styles.searchingEmoji}>🛺</Text>
        </View>
        <Text style={styles.searchingTitle}>{t('rides.searchingTitle')}</Text>
        <Text style={styles.searchingSubtitle}>{t('rides.searchingSubtitle')}</Text>
      </View>
    </ScreenShell>
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

export function RideConfirmedScreen({ ride, onHome, onCancelled, onFareQuoteCancelled, onBookings, onProfile, onOpenChat }: { ride: CustomerRide; onHome: () => void; onCancelled: () => void; onFareQuoteCancelled: () => void; onBookings: () => void; onProfile: () => void; onOpenChat: (rideId: string, captainName: string) => void }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const mapRef = useRef<MapView>(null);
  const [cancelStep, setCancelStep] = useState<'none' | 'confirm' | 'reason'>('none');
  const [cancellationReason, setCancellationReason] = useState<CancellationReason | null>(null);
  const [otherReason, setOtherReason] = useState('');
  const [cancellationError, setCancellationError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [updatingFareQuote, setUpdatingFareQuote] = useState(false);
  const [fareQuoteExpiring, setFareQuoteExpiring] = useState(false);
  const [fareQuoteSecondsRemaining, setFareQuoteSecondsRemaining] = useState<number | null>(null);
  const fareQuoteDecisionInFlight = useRef(false);
  const fareQuoteTimeoutHandledForAcceptance = useRef<string | null>(null);
  const fareQuoteWasPending = useRef(false);
  const [liveStatus, setLiveStatus] = useState<RideStatus>('accepted');
  const [liveRide, setLiveRide] = useState<DispatchRide | null>(null);
  const [captainDetails, setCaptainDetails] = useState<AssignedCaptainDetails | null>(null);
  const [pickupPin, setPickupPin] = useState<string | null>(null);
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

  useEffect(() => {
    mapRef.current?.fitToCoordinates([pickup], { animated: true, edgePadding: { top: 120, right: 50, bottom: 300, left: 50 } });
    return undefined;
  }, []);
  useEffect(() => {
    setLiveRide(null);
    setCaptainDetails(null);
    setPickupPin(null);
    setCaptainRoute([]);
  }, [ride.id]);
  useEffect(() => {
    if (!ride.id || ride.id.startsWith('local-')) return;
    return rideDispatchService.subscribeToRide(ride.id, (updatedRide) => {
      if (updatedRide.fare_approval_status === 'pending') fareQuoteWasPending.current = true;
      if (updatedRide.status === 'cancelled' && fareQuoteWasPending.current) {
        onFareQuoteCancelled();
        return;
      }
      setLiveStatus(updatedRide.status);
      setLiveRide(updatedRide);
      if (updatedRide.captain_id) {
        void rideDispatchService.getAssignedCaptain(updatedRide.id).then(setCaptainDetails).catch(() => setCaptainDetails(null));
      }
      if ((updatedRide.status === 'accepted' || updatedRide.status === 'arrived') && pickupOtpIssuedForRide.current !== updatedRide.id) {
        pickupOtpIssuedForRide.current = updatedRide.id;
        void rideDispatchService.issueCustomerPickupOtp(updatedRide.id).then(setPickupPin).catch(() => {
          pickupOtpIssuedForRide.current = null;
          setPickupPin(null);
        });
      }
    });
  }, [onFareQuoteCancelled, onHome, ride.id]);
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
      if (!rideId || !activeRide || !['requested', 'searching', 'accepted', 'arrived', 'in_progress'].includes(activeRide.status)) throw new Error('Ride can no longer be cancelled');
      await rideCreationService.cancel(rideId, cancellationReason, otherReason);
      dialog({ title: t('rides.rideCancelled'), message: cancellationMayIncurCharge ? t('rides.cancellationChargePending') : undefined, buttons: [{ text: t('actions.done'), onPress: onCancelled }] });
    } catch {
      setCancellationError(t('login.tryAgain'));
    } finally {
      setCancelling(false);
    }
  };
  const respondToFareQuote = useCallback(async (accept: boolean) => {
    if (!ride.id || fareQuoteDecisionInFlight.current) return;
    fareQuoteDecisionInFlight.current = true;
    setUpdatingFareQuote(true);
    try {
      const updatedRide = await rideDispatchService.approveFareQuote(ride.id, accept);
      if (!accept && updatedRide.status === 'cancelled') onFareQuoteCancelled();
    } catch {
      const currentRide = await rideDispatchService.getRide(ride.id).catch(() => null);
      if (!accept && currentRide?.status === 'cancelled') {
        onFareQuoteCancelled();
        return;
      }
      dialog({ title: t('login.tryAgain') });
    } finally {
      fareQuoteDecisionInFlight.current = false;
      setUpdatingFareQuote(false);
    }
  }, [onFareQuoteCancelled, ride.id, t]);
  const expireFareQuote = useCallback(async () => {
    if (!ride.id || fareQuoteDecisionInFlight.current) return;
    fareQuoteDecisionInFlight.current = true;
    setFareQuoteExpiring(true);
    try {
      const updatedRide = await rideDispatchService.approveFareQuote(ride.id, false);
      if (updatedRide.status === 'cancelled') onFareQuoteCancelled();
    } catch {
      const currentRide = await rideDispatchService.getRide(ride.id).catch(() => null);
      if (currentRide?.status === 'cancelled') onFareQuoteCancelled();
      // Otherwise wait for the existing authoritative timeout subscription/poll.
    } finally {
      fareQuoteDecisionInFlight.current = false;
      setUpdatingFareQuote(false);
    }
  }, [onFareQuoteCancelled, ride.id]);
  const awaitingFareApproval = liveRide?.fare_approval_status === 'pending';

  useEffect(() => {
    if (!awaitingFareApproval || !liveRide?.accepted_at || updatingFareQuote) {
      setFareQuoteSecondsRemaining(null);
      if (!awaitingFareApproval) {
        fareQuoteDecisionInFlight.current = false;
        fareQuoteTimeoutHandledForAcceptance.current = null;
        setFareQuoteExpiring(false);
      }
      return;
    }
    const expiresAt = new Date(liveRide.accepted_at).getTime() + 30_000;
    let active = true;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      if (!active) return;
      setFareQuoteSecondsRemaining(remaining);
      if (remaining === 0 && fareQuoteTimeoutHandledForAcceptance.current !== liveRide.accepted_at) {
        fareQuoteTimeoutHandledForAcceptance.current = liveRide.accepted_at ?? null;
        void expireFareQuote();
      }
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [awaitingFareApproval, expireFareQuote, liveRide?.accepted_at, updatingFareQuote]);

  const liveFareDisplay = getCustomerFareDisplay({ kind: ride.kind, passengerCount: ride.passengerCount, routeQuote: ride.routeQuote, backendRide: liveRide });

  if (liveStatus === 'completed' && ride.id) {
    return <CustomerRideSettlement rideId={ride.id} fare={liveFareDisplay.customerCharge ?? 0} captainName={captainName} paymentStatus={liveRide?.payment_status ?? 'pending'} freeRide={liveFareDisplay.isFree} onHome={onHome} />;
  }
  const displayedCaptainCoordinate = liveRide?.captain_latitude != null && liveRide?.captain_longitude != null
    ? { latitude: Number(liveRide.captain_latitude), longitude: Number(liveRide.captain_longitude) }
    : null;
  const displayedApproachRoute = captainRoute.length > 1 ? captainRoute : [];
  const inProgress = liveStatus === 'in_progress';

  return <SafeAreaView style={styles.assignedSafe} edges={['top', 'left', 'right']}>
    <MapView ref={mapRef} provider={PROVIDER_GOOGLE} initialRegion={NANDYAL} style={StyleSheet.absoluteFill}>
      <Marker coordinate={pickup} pinColor={colors.success} title={t('rides.pickup')} />
      {displayedApproachRoute.length > 1 && <Polyline coordinates={displayedApproachRoute} strokeColor={colors.primaryDark} strokeWidth={5} />}
      {displayedCaptainCoordinate && <Marker.Animated coordinate={displayedCaptainCoordinate}><View style={styles.liveCaptainMarker}><Text style={styles.liveCaptainIcon}>🛺</Text></View></Marker.Animated>}
    </MapView>
    <Pressable onPress={onHome} accessibilityRole="button" style={[styles.assignedBack, shadows.soft]}><Text style={styles.rideOptionsBackText}>‹</Text></Pressable>
    <ScrollView style={[styles.assignedSheet, shadows.card]} contentContainerStyle={styles.assignedSheetContent} showsVerticalScrollIndicator={false} nestedScrollEnabled bounces={false}>
      <View style={styles.sheetHandle} />
      {!arrived && <Text style={styles.bookingStatus}>{awaitingFareApproval ? t('rides.fareQuoteWaiting') : liveStatus === 'accepted' ? t('rides.bookedMessage') : t('rides.searchingSubtitle')}</Text>}
      <View style={styles.assignedHeading}><View><Text style={styles.assignedTitle}>{t(inProgress ? 'rides.startedTitle' : arrived ? 'rides.hereTitle' : awaitingFareApproval ? 'rides.fareQuoteTitle' : 'rides.confirmedTitle')}</Text><Text style={styles.assignedSubtitle}>{inProgress ? t('rides.startedSubtitle') : arrived ? t('rides.hereSubtitle') : awaitingFareApproval ? t('rides.fareQuoteWaiting') : t('rides.arriving')}</Text></View></View>
      {hasCurrentRide && <View style={styles.assignedCaptainRow}><View style={styles.captainAvatar}><Text style={styles.captainAvatarEmoji}>👤</Text></View><View style={styles.assignedCaptainText}><Text style={styles.captainName}>{captainName}</Text><Text style={styles.assignedVehicle}>{vehicleType ? t(`rides.${vehicleType}`) : t('rides.captain')}</Text></View><View style={styles.assignedContact}><Pressable onPress={() => { if (ride.id) onOpenChat(ride.id, captainName); }} accessibilityRole="button" accessibilityLabel="Message captain" accessibilityState={{ disabled: !ride.id }} disabled={!ride.id} style={[styles.assignedCall, !ride.id && styles.assignedCallDisabled]}><Text style={styles.assignedCallText}>✉</Text></Pressable><Pressable onPress={() => { void callCaptain(); }} accessibilityRole="button" accessibilityLabel="Call captain" accessibilityState={{ disabled: !captainDetails?.phone }} disabled={!captainDetails?.phone} style={[styles.assignedCall, !captainDetails?.phone && styles.assignedCallDisabled]}><Text style={styles.assignedCallText}>☎</Text></Pressable></View></View>}
      {liveRide?.fare_approval_status === 'pending' && <View style={styles.fareQuoteCard}>
        <Text style={styles.fareQuoteTitle}>{t('rides.fareQuoteTitle')}</Text>
        <Text style={styles.fareQuoteCountdown}>{fareQuoteSecondsRemaining ?? 30}s</Text>
        <Text style={styles.fareQuoteMessage}>{t('rides.fareQuoteMessage', { distance: formatNumber(Number(liveRide.pickup_distance_meters ?? 0) / 1000, { maximumFractionDigits: 1 }) })}</Text>
        <SummaryRow label={t('rides.fareQuoteRide')} value={formatFare(Number(liveRide.base_fare ?? 0) + Number(liveRide.distance_surcharge ?? 0))} icon="🛺" />
        <SummaryRow label={t('rides.fareQuotePickup')} value={formatFare(Number(liveRide.pickup_surcharge ?? 0))} icon="+" />
        <SummaryRow label={t('rides.fareQuoteTotal')} value={liveFareDisplay.isFree ? t('rides.freeRideAmount') : formatFare(liveFareDisplay.customerCharge ?? 0)} icon="₹" last />
        <PrimaryButton label={updatingFareQuote || fareQuoteExpiring ? t('login.pleaseWait') : t('rides.acceptFareQuote')} onPress={() => { void respondToFareQuote(true); }} disabled={updatingFareQuote || fareQuoteExpiring} />
        <PrimaryButton label={t('rides.declineFareQuote')} onPress={startCancellation} danger disabled={updatingFareQuote || fareQuoteExpiring} />
      </View>}
      <View style={styles.assignedPickupRow}><View style={styles.assignedPickupDot} /><Text style={styles.assignedPickupText} numberOfLines={2}>{t('rides.pickup')} · {ride.pickup}</Text></View>
      <View style={styles.assignedPickupRow}><View style={[styles.assignedPickupDot, styles.assignedDropDot]} /><Text style={styles.assignedPickupText} numberOfLines={2}>{t('rides.drop')} · {ride.drop}</Text></View>
      {!!pickupPin && !inProgress && <View style={styles.pickupPinCard}><Text style={styles.pickupPinLabel}>{t('rides.pickupPinLabel')}</Text><Text style={styles.pickupPin}>{pickupPin}</Text><Text style={styles.pickupPinHint}>{t('rides.pickupPinHint')}</Text></View>}
      {inProgress && <><View style={styles.tripStatRow}><Text style={styles.tripStatLabel}>{t('rides.destinationDistance')}</Text><Text style={styles.tripStatValue}>{liveRide?.trip_distance_meters == null ? '—' : `${formatNumber(Number(liveRide.trip_distance_meters) / 1000, { maximumFractionDigits: 1 })} km`}</Text></View><Pressable onPress={() => { void Linking.openURL('tel:112'); }} accessibilityRole="button" style={styles.sosButton}><Text style={styles.sosText}>{t('rides.sos')}</Text></Pressable></>}
      {canCancel && !awaitingFareApproval && <PrimaryButton label={t('rides.cancelRide')} onPress={startCancellation} danger />}
    </ScrollView>
    <CustomerTabBar active="bookings" onHome={onHome} onBookings={onBookings} onProfile={onProfile} />
    {cancelStep !== 'none' && <View style={styles.cancellationOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => setCancelStep('none')} />
      <View style={[styles.cancellationSheet, shadows.card]}>
        <View style={styles.sheetHandle} />
        <ScrollView bounces={false} contentContainerStyle={styles.cancellationContent} showsVerticalScrollIndicator={false}>
          {cancelStep === 'confirm' ? <>
            <Text style={styles.cancellationTitle}>{t('rides.cancelTitle')}</Text>
            <View style={styles.captainStatusCard}>
              <Text style={styles.captainStatusIcon}>🛺</Text>
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
    </View>}
  </SafeAreaView>;
}

function BookingDetailsSheet({ ride, captain, onClose }: { ride: DispatchRide; captain: AssignedCaptainDetails | null | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const progress = useRef(new Animated.Value(0)).current;
  const [closing, setClosing] = useState(false);
  const fareDisplay = getCustomerFareDisplay({ kind: ride.ride_type, passengerCount: Number(ride.passenger_count ?? 1), backendRide: ride });
  const rating = Number(ride.customer_rating ?? 0);
  useEffect(() => { Animated.timing(progress, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [progress]);
  const dismiss = () => { if (closing) return; setClosing(true); Animated.timing(progress, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) onClose(); }); };
  return <Animated.View style={[styles.bookingDetailsOverlay, { opacity: progress }]}>
    <Pressable onPress={dismiss} style={StyleSheet.absoluteFill} accessibilityRole="button" />
    <Animated.View style={[styles.bookingDetailsSheet, shadows.card, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }] }]}>
      <View style={styles.sheetHandle} />
      <View style={styles.bookingDetailsHero}><View style={styles.bookingDetailsHeroIcon}><Text style={styles.bookingDetailsHeroIconText}>{ride.ride_type === 'bike' ? '🏍️' : '🛺'}</Text></View><View style={styles.bookingDetailsHeroText}><Text style={styles.bookingDetailsTitle}>{t('rides.rideDetailsTitle')}</Text><Text style={styles.bookingDetailsStatus}>{t(`rides.status${ride.status}`)}</Text></View><Pressable onPress={dismiss} accessibilityRole="button" style={styles.bookingDetailsClose}><Text style={styles.bookingDetailsCloseText}>×</Text></Pressable></View>
      <ScrollView contentContainerStyle={styles.bookingDetailsContent} showsVerticalScrollIndicator={false}>
        <View style={styles.bookingDetailsSection}><Text style={styles.bookingDetailsSectionTitle}>{t('rides.routeDetails')}</Text><View style={styles.bookingDetailRow}><View style={styles.assignedPickupDot} /><View style={styles.bookingDetailText}><Text style={styles.bookingDetailLabel}>{t('rides.pickup')}</Text><Text style={styles.bookingDetailValue}>{ride.pickup_address}</Text></View></View><View style={styles.bookingDetailDivider} /><View style={styles.bookingDetailRow}><View style={[styles.assignedPickupDot, styles.assignedDropDot]} /><View style={styles.bookingDetailText}><Text style={styles.bookingDetailLabel}>{t('rides.drop')}</Text><Text style={styles.bookingDetailValue}>{ride.drop_address}</Text></View></View></View>
        <View style={styles.bookingDetailsSection}><Text style={styles.bookingDetailsSectionTitle}>{t('rides.fareDetails')}</Text><View style={styles.bookingFareGrid}><View style={styles.bookingFareTile}><Text style={styles.bookingDetailLabel}>{t('rides.customerCharge')}</Text><Text style={styles.bookingDetailAmountValue}>{fareDisplay.isFree ? t('rides.freeRideAmount') : formatFare(fareDisplay.customerCharge ?? 0)}</Text></View>{fareDisplay.finalFare != null && <View style={styles.bookingFareTile}><Text style={styles.bookingDetailLabel}>{t('rides.finalFare')}</Text><Text style={styles.bookingDetailAmountValue}>{formatFare(fareDisplay.finalFare)}</Text></View>}</View>{Number(ride.cancellation_charge ?? 0) > 0 && <View style={styles.bookingDetailAmount}><Text style={styles.bookingDetailLabel}>{t('rides.cancellationCharge')}</Text><Text style={styles.bookingDetailAmountValue}>{formatFare(Number(ride.cancellation_charge))}</Text></View>}</View>
        <View style={styles.bookingDetailsSection}><Text style={styles.bookingDetailsSectionTitle}>{t('rides.captainDetails')}</Text><View style={styles.bookingCaptainRow}><View style={styles.bookingCaptainAvatar}><Text style={styles.bookingCaptainAvatarText}>👤</Text></View><View style={styles.bookingDetailText}>{captain === undefined ? <Text style={styles.bookingDetailLoading}>{t('login.pleaseWait')}</Text> : captain ? <><Text style={styles.bookingDetailValue}>{captain.fullName}</Text><Text style={styles.bookingDetailLabel}>{captain.vehicleType ? t(`rides.${captain.vehicleType}`) : t('rides.captain')}</Text></> : <Text style={styles.bookingDetailLabel}>{t('rides.noCaptainAssigned')}</Text>}</View></View></View>
        <View style={styles.bookingDetailsSection}><Text style={styles.bookingDetailsSectionTitle}>{t('rides.ratingGiven')}</Text><View style={styles.bookingRatingRow}>{rating > 0 ? <><Text style={styles.bookingRating}>{'★'.repeat(Math.min(5, rating))}{'☆'.repeat(Math.max(0, 5 - rating))}</Text><Text style={styles.bookingRatingNumber}>{rating}/5</Text></> : <Text style={styles.bookingDetailLabel}>{t('rides.notRatedYet')}</Text>}</View></View>
      </ScrollView>
      <PrimaryButton label={t('actions.done')} onPress={dismiss} />
    </Animated.View>
  </Animated.View>;
}

export function CustomerBookingsScreen({ ride, onHome, onProfile, onCancelled, onOpenRide }: { ride: CustomerRide; onHome: () => void; onProfile: () => void; onCancelled: () => void; onOpenRide: (ride: CustomerRide, status: RideStatus) => void }) {
  const { t, i18n } = useTranslation();
  const dialog = useDialog();
  const [history, setHistory] = useState<DispatchRide[]>([]); const [loaded, setLoaded] = useState(!rideDispatchService.isEnabled); const [filter, setFilter] = useState<RideHistoryFilter>('all'); const [cancellingRideId, setCancellingRideId] = useState<string | null>(null); const [detailsRide, setDetailsRide] = useState<DispatchRide | null>(null); const [detailsCaptain, setDetailsCaptain] = useState<AssignedCaptainDetails | null | undefined>(null);
  useEffect(() => {
    if (!rideDispatchService.isEnabled) return;
    return rideDispatchService.subscribeToCustomerRideHistory((rides) => { setHistory(rides); setLoaded(true); }, () => setLoaded(true));
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
  return <SafeAreaView style={styles.bookingsSafe} edges={['top', 'left', 'right']}><ScrollView contentContainerStyle={styles.bookingsContent} showsVerticalScrollIndicator={false}><Text style={styles.bookingsTitle}>{t('home.bookingsTitle')}</Text><RideHistoryFilterControl value={filter} onChange={setFilter} />{filter !== 'all' && <Text style={styles.bookingsPeriod}>{t('history.showing')} {rideHistoryPeriodLabel(filter, new Date(), i18n.language)}</Text>}{!loaded && <Text style={styles.bookingsEmpty}>{t('login.pleaseWait')}</Text>}{loaded && !rides.length && <Text style={styles.bookingsEmpty}>{filter === 'all' ? t('home.bookingsMessage') : t('history.empty')}</Text>}{rides.map((record) => { const canCancel = record.status === 'searching' || record.status === 'accepted'; const actionLabel = record.status === 'cancelled' || record.status === 'completed' ? t('rides.bookThisRoute') : t('rides.viewRideStatus'); const isCancelling = cancellingRideId === record.id; return <View key={record.id} style={[styles.bookingCard, shadows.card]}><Text style={styles.bookingCardStatus}>{t(`rides.status${record.status}`)}</Text><Text style={styles.bookingCardRoute} numberOfLines={1}>{record.pickup_address}</Text><Text style={styles.bookingCardArrow}>→</Text><Text style={styles.bookingCardRoute} numberOfLines={1}>{record.drop_address}</Text><View style={styles.bookingCardActions}><Pressable onPress={() => openDetails(record)} accessibilityRole="button" style={styles.bookingDetailsButton}><Text style={styles.bookingDetailsButtonText}>{t('rides.rideDetails')}</Text></Pressable><Pressable onPress={() => onOpenRide(customerRide(record), record.status)} accessibilityRole="button" style={styles.bookingRouteButton}><Text style={styles.bookingRouteButtonText}>{actionLabel}</Text></Pressable></View>{canCancel && <PrimaryButton label={isCancelling ? t('login.pleaseWait') : t('rides.cancelRide')} onPress={() => cancel(record.id)} disabled={isCancelling} danger />}</View>; })}</ScrollView><CustomerTabBar active="bookings" onHome={onHome} onBookings={() => undefined} onProfile={onProfile} />{detailsRide && <BookingDetailsSheet ride={detailsRide} captain={detailsCaptain} onClose={() => setDetailsRide(null)} />}</SafeAreaView>;
}

function CustomerTabBar({ active, onHome, onBookings, onProfile }: { active: 'home' | 'bookings'; onHome: () => void; onBookings: () => void; onProfile: () => void }) {
  const { t } = useTranslation();
  const dialog = useDialog();
  return <View style={styles.homeTabBar}><HomeTab icon="⌂" label={t('home.tabHome')} active={active === 'home'} onPress={onHome} /><HomeTab icon="▤" label={t('home.tabBookings')} active={active === 'bookings'} onPress={onBookings} /><HomeTab icon="?" label={t('home.tabHelp')} onPress={() => dialog({ title: t('home.helpTitle'), message: t('home.helpMessage') })} /><HomeTab icon="♙" label={t('home.tabProfile')} onPress={onProfile} /></View>;
}

/* ─────────────────────────── STYLES ─────────────────────────── */

const styles = StyleSheet.create({
  // Map-led customer home
  mapHomeSafe: { flex: 1, backgroundColor: colors.primaryLight },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  modalCard: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 24, width: '85%', maxWidth: 340, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  modalEmoji: { fontSize: 48, marginBottom: 16 },
  modalTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900', textAlign: 'center', marginBottom: 10 },
  modalMessage: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  modalButton: { backgroundColor: colors.primary, borderRadius: radii.pill, paddingVertical: 12, paddingHorizontal: 32, width: '100%', alignItems: 'center' },
  modalButtonText: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  mapRecenterButton: { alignItems: 'center', height: 52, justifyContent: 'center', position: 'absolute', right: 12, width: 52, zIndex: 3 },
  mapRecenterIcon: { color: colors.primaryDark, fontSize: 34, fontWeight: '800', lineHeight: 38, textShadowColor: 'rgba(255,255,255,0.85)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  recenterIcon: { color: colors.primary, fontSize: 29, fontWeight: '800', lineHeight: 32 },
  currentLocationDot: { backgroundColor: '#14B8A6', borderColor: '#FFFFFF', borderRadius: 13, borderWidth: 4, height: 26, width: 26, ...shadows.card },
  mapFallback: { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: radii.pill, left: 20, paddingHorizontal: 14, paddingVertical: 8, position: 'absolute', right: 78, top: 90 },
  mapFallbackText: { color: colors.textSecondary, fontFamily, fontSize: fontSize.xs, textAlign: 'center' },
  locationNotice: { backgroundColor: colors.accentLight, borderColor: '#F6C7B4', borderRadius: radii.md, borderWidth: 1, left: 20, paddingHorizontal: 12, paddingVertical: 9, position: 'absolute', right: 20, top: 92 },
  locationNoticeText: { color: colors.accent, fontFamily, fontSize: fontSize.xs, fontWeight: '700', textAlign: 'center' },
  homeSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 76, left: 0, overflow: 'hidden', position: 'absolute', right: 0, zIndex: 6 },
  homeSheetLayer: { elevation: 6 },
  homeSheetBackdrop: { ...StyleSheet.absoluteFillObject, height: '100%', opacity: 0.22, width: '100%' },
  sheetHandleArea: { alignItems: 'center', minHeight: 52, paddingBottom: 14, paddingTop: 15 },
  sheetHandle: { backgroundColor: '#CBC5BB', borderRadius: radii.pill, height: 5, width: 46 },
  homeSheetScroll: { flex: 1 },
  homeSheetContent: { gap: 14, paddingBottom: 24, paddingHorizontal: 16 },
  promotionCard: { backgroundColor: colors.successLight, borderColor: colors.success, borderRadius: radii.md, borderWidth: 1, gap: 3, padding: 12 },
  promotionCardCompact: { padding: 10 },
  promotionTitle: { color: colors.success, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  promotionDetail: { color: colors.textPrimary, fontFamily, fontSize: fontSize.xs, lineHeight: 18 },
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
  landmarkCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, minHeight: 66, opacity: 0.94, paddingHorizontal: 5, paddingTop: 8 },
  landmarkIcon: { color: colors.primary, fontSize: 18, marginBottom: 3 },
  landmarkText: { color: colors.textPrimary, fontFamily, fontSize: 10, lineHeight: 13, textAlign: 'center' },
  homeTabBar: { backgroundColor: colors.surface, borderColor: colors.border, borderTopWidth: 1, bottom: 0, elevation: 7, flexDirection: 'row', justifyContent: 'space-around', left: 0, minHeight: 76, paddingBottom: 11, paddingTop: 9, position: 'absolute', right: 0, zIndex: 7 },
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
  pinPickerGps: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.pill, height: 48, justifyContent: 'center', position: 'absolute', right: 18, top: 28, width: 48 },
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
  routeSummaryText: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.xs, fontWeight: '700' },
  routeSummaryArrow: { color: colors.accent, fontSize: 16, fontWeight: '800' },
  rideOptionsSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 0, gap: 12, left: 0, padding: 16, paddingBottom: 22, position: 'absolute', right: 0 },
  rideOptionsHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  rideOptionsHeading: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' },
  rideFareHeading: { color: colors.textMuted, fontFamily, fontSize: fontSize.xs, fontWeight: '800', textTransform: 'uppercase' },
  rideOptionList: { gap: 2 },
  rideOptionsExtras: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', height: 48, justifyContent: 'space-around' },
  rideOptionsExtra: { color: colors.textPrimary, fontFamily, fontSize: fontSize.sm, fontWeight: '700' },
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
  rideFareWrap: { alignItems: 'flex-end', gap: 1 },
  rideFareWrapStart: { alignItems: 'flex-start' },
  rideFareStruck: { color: colors.textMuted, fontSize: fontSize.sm, textDecorationLine: 'line-through' },
  rideFareFree: { color: colors.primaryDark, fontFamily, fontSize: fontSize.lg, fontWeight: '900' },
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
  assignedSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, bottom: 76, left: 0, maxHeight: '68%', position: 'absolute', right: 0 },
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
  fareQuoteCard: { backgroundColor: colors.accentLight, borderColor: colors.accent, borderRadius: radii.md, borderWidth: 1, gap: 10, padding: 14 },
  fareQuoteTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' },
  fareQuoteCountdown: { color: colors.error, fontFamily, fontSize: fontSize.md, fontWeight: '900', textAlign: 'center' },
  fareQuoteMessage: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 },
  declineFareQuote: { alignItems: 'center', minHeight: 38, justifyContent: 'center' },
  declineFareQuoteText: { color: colors.error, fontFamily, fontSize: fontSize.sm, fontWeight: '800' },
  assignedContact: { flexDirection: 'row', gap: 7 }, assignedCall: { alignItems: 'center', backgroundColor: colors.primaryLight, borderRadius: radii.pill, height: 38, justifyContent: 'center', width: 38 }, assignedCallDisabled: { opacity: 0.45 },
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
  assignedPickupText: { color: colors.textPrimary, flex: 1, fontFamily, fontSize: fontSize.md, fontWeight: '800', lineHeight: 23 }, assignedDropDot: { backgroundColor: colors.accent }, editLocation: { color: colors.primary, fontSize: 28, fontWeight: '800' },
  bookingsSafe: { backgroundColor: colors.bg, flex: 1 }, bookingsContent: { gap: 16, padding: 20, paddingBottom: 112 }, bookingsTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize['2xl'], fontWeight: '900' }, bookingsPeriod: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '800', marginTop: -8 }, bookingsEmpty: { color: colors.textSecondary, fontFamily, fontSize: fontSize.md, lineHeight: 24 }, bookingCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1, gap: 8, padding: 18 }, bookingCardStatus: { color: colors.primary, fontFamily, fontSize: fontSize.sm, fontWeight: '900' }, bookingCardRoute: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800' }, bookingCardArrow: { color: colors.textMuted, fontSize: 20 }, bookingCardActions: { flexDirection: 'row', gap: 10, marginTop: 8 }, bookingDetailsButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 8 }, bookingDetailsButtonText: { color: colors.primaryDark, fontFamily, fontSize: fontSize.sm, fontWeight: '800', textAlign: 'center' }, bookingRouteButton: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: radii.md, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 8 }, bookingRouteButtonText: { color: colors.bg, fontFamily, fontSize: fontSize.sm, fontWeight: '800', textAlign: 'center' }, bookingDetailsOverlay: { backgroundColor: 'rgba(6, 78, 69, 0.58)', bottom: 0, justifyContent: 'flex-end', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 20 }, bookingDetailsSheet: { backgroundColor: colors.bg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, gap: 16, maxHeight: '90%', paddingBottom: 24, paddingHorizontal: 20, paddingTop: 14 }, bookingDetailsHero: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: radii.lg, flexDirection: 'row', gap: 11, padding: 14 }, bookingDetailsHeroIcon: { alignItems: 'center', backgroundColor: colors.surfaceMint, borderRadius: radii.pill, height: 46, justifyContent: 'center', width: 46 }, bookingDetailsHeroIconText: { fontSize: 23 }, bookingDetailsHeroText: { flex: 1, gap: 3 }, bookingDetailsTitle: { color: colors.textOnPrimary, fontFamily, fontSize: fontSize.lg, fontWeight: '900' }, bookingDetailsClose: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radii.pill, height: 34, justifyContent: 'center', width: 34 }, bookingDetailsCloseText: { color: colors.textOnPrimary, fontSize: 27, lineHeight: 30 }, bookingDetailsContent: { gap: 12, paddingBottom: 2 }, bookingDetailsStatus: { alignSelf: 'flex-start', backgroundColor: colors.surfaceMint, borderRadius: radii.pill, color: colors.primaryDark, fontFamily, fontSize: fontSize.xs, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4 }, bookingDetailsSection: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: 10, padding: 14 }, bookingDetailsSectionTitle: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, bookingDetailRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 }, bookingDetailDivider: { backgroundColor: colors.divider, height: 1, marginLeft: 20 }, bookingDetailText: { flex: 1 }, bookingDetailLabel: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm, lineHeight: 20 }, bookingDetailValue: { color: colors.textPrimary, fontFamily, fontSize: fontSize.md, fontWeight: '800', lineHeight: 22 }, bookingDetailAmount: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, bookingFareGrid: { flexDirection: 'row', gap: 10 }, bookingFareTile: { backgroundColor: colors.primaryLight, borderRadius: radii.sm, flex: 1, gap: 3, padding: 11 }, bookingDetailAmountValue: { color: colors.primaryDark, fontFamily, fontSize: fontSize.md, fontWeight: '900' }, bookingCaptainRow: { alignItems: 'center', flexDirection: 'row', gap: 10 }, bookingCaptainAvatar: { alignItems: 'center', backgroundColor: colors.accentLight, borderRadius: radii.pill, height: 42, justifyContent: 'center', width: 42 }, bookingCaptainAvatarText: { fontSize: 20 }, bookingDetailLoading: { color: colors.textSecondary, fontFamily, fontSize: fontSize.sm }, bookingRatingRow: { alignItems: 'center', flexDirection: 'row', gap: 10 }, bookingRating: { color: '#F59E0B', fontSize: 27, letterSpacing: 2 }, bookingRatingNumber: { color: colors.primaryDark, fontFamily, fontSize: fontSize.md, fontWeight: '900' },
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
  summaryLocationIcon: { alignItems: 'center', backgroundColor: colors.successLight, borderRadius: radii.pill, height: 26, justifyContent: 'center', marginTop: 1, width: 26 },
  summaryLocationIconDrop: { backgroundColor: '#F7E2DE' },
  summaryLocationIconText: { color: colors.success, fontSize: 14, lineHeight: 18 },
  summaryLocationIconTextDrop: { color: '#B7655A' },
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
