import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

// This task name and its definition must remain module-scoped: Expo can boot
// the JS bundle solely to deliver a background location update.
export const ACTIVE_RIDE_GPS_TASK = 'sawaari-active-ride-gps-v1';
const CONTEXT_KEY = 'sawaari.captain.activeRideGps.context.v1';
const QUEUE_KEY = 'sawaari.captain.activeRideGps.pending.v1';
const TARGET_INTERVAL_MS = 45_000;
const MIN_ACCEPTED_INTERVAL_MS = 35_000;
const MAX_PENDING_SAMPLES = 80;

type TrackingContext = { rideId: string; trackingSessionId: string; nextSequence: number; lastAcceptedAt: number };
type PendingSample = {
  rideId: string; trackingSessionId: string; sequenceNumber: number; deviceRecordedAt: string;
  latitude: number; longitude: number; accuracyMeters: number; speedMps: number | null;
  headingDegrees: number | null; altitudeMeters: number | null; mockedLocation: boolean | null;
};

const readJson = async <T>(key: string): Promise<T | null> => {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { await AsyncStorage.removeItem(key); return null; }
};
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

async function send(sample: PendingSample): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  const { error } = await supabase.rpc('record_active_ride_location', {
    p_ride_id: sample.rideId, p_tracking_session_id: sample.trackingSessionId,
    p_sequence_number: sample.sequenceNumber, p_device_recorded_at: sample.deviceRecordedAt,
    p_latitude: sample.latitude, p_longitude: sample.longitude, p_accuracy_meters: sample.accuracyMeters,
    p_speed_mps: sample.speedMps, p_heading_degrees: sample.headingDegrees,
    p_altitude_meters: sample.altitudeMeters, p_mocked_location: sample.mockedLocation,
  });
  if (!error) return true;
  // Terminal-state and authorization failures cannot become valid later; do
  // not endlessly retain them. Transient/network failures remain queued.
  if (/Started ride not found/i.test(error.message)) {
    // A terminal backend state can be observed by the task before the UI gets
    // its Realtime event. Stop the persisted native task immediately.
    if (Platform.OS !== 'web' && await Location.hasStartedLocationUpdatesAsync(ACTIVE_RIDE_GPS_TASK)) await Location.stopLocationUpdatesAsync(ACTIVE_RIDE_GPS_TASK);
    await AsyncStorage.multiRemove([CONTEXT_KEY, QUEUE_KEY]);
    return true;
  }
  if (/GPS sample timestamp|permission|JWT|not authenticated/i.test(error.message)) return true;
  return false;
}

async function flushPending(): Promise<void> {
  const queue = (await readJson<PendingSample[]>(QUEUE_KEY)) ?? [];
  if (!queue.length) return;
  const remaining: PendingSample[] = [];
  for (const sample of queue) if (!(await send(sample))) remaining.push(sample);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining.slice(-MAX_PENDING_SAMPLES)));
}

async function capture(location: Location.LocationObject): Promise<void> {
  const context = await readJson<TrackingContext>(CONTEXT_KEY);
  if (!context || location.timestamp - context.lastAcceptedAt < MIN_ACCEPTED_INTERVAL_MS) return;
  const { coords } = location;
  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) || !Number.isFinite(coords.accuracy) || coords.accuracy! < 0) return;
  const normalizedSpeed = coords.speed != null && coords.speed >= 0 && coords.speed <= 150 ? coords.speed : null;
  const normalizedHeading = coords.heading != null && coords.heading >= 0 && coords.heading <= 360 ? coords.heading : null;
  const sample: PendingSample = {
    rideId: context.rideId, trackingSessionId: context.trackingSessionId, sequenceNumber: context.nextSequence,
    deviceRecordedAt: new Date(location.timestamp).toISOString(), latitude: coords.latitude, longitude: coords.longitude,
    accuracyMeters: coords.accuracy!, speedMps: normalizedSpeed, headingDegrees: normalizedHeading,
    altitudeMeters: coords.altitude ?? null, mockedLocation: location.mocked ?? null,
  };
  const queue = ((await readJson<PendingSample[]>(QUEUE_KEY)) ?? []).concat(sample).slice(-MAX_PENDING_SAMPLES);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify({ ...context, nextSequence: context.nextSequence + 1, lastAcceptedAt: location.timestamp }));
  await flushPending();
}

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(ACTIVE_RIDE_GPS_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  for (const location of data.locations) await capture(location);
});

async function requestBackgroundPermission(): Promise<boolean> {
  const foreground = await Location.getForegroundPermissionsAsync();
  const foregroundResult = foreground.status === 'granted' ? foreground : await Location.requestForegroundPermissionsAsync();
  if (foregroundResult.status !== 'granted') return false;
  const background = await Location.getBackgroundPermissionsAsync();
  if (background.status === 'granted') return true;
  return new Promise((resolve) => Alert.alert(
    'Allow location all the time',
    'To track an active ride while Sawaari Captain is minimized, open Settings, then tap Permissions → Location → Allow all the time. Tracking is used only during an active ride and stops when it ends.',
    [{ text: 'Not now', style: 'cancel', onPress: () => resolve(false) }, { text: 'Open Settings', onPress: () => { void Linking.openSettings().finally(() => resolve(false)); } }],
  ));
}

export const activeRideGpsTracking = {
  async start(rideId: string): Promise<void> {
    if (Platform.OS === 'web') return;
    const allowed = await requestBackgroundPermission();
    if (!allowed) throw new Error('ACTIVE_RIDE_BACKGROUND_LOCATION_REQUIRED');
    const old = await readJson<TrackingContext>(CONTEXT_KEY);
    const context: TrackingContext = old?.rideId === rideId
      ? old
      : { rideId, trackingSessionId: uuid(), nextSequence: 0, lastAcceptedAt: 0 };
    await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
    await flushPending();
    if (!(await Location.hasStartedLocationUpdatesAsync(ACTIVE_RIDE_GPS_TASK))) {
      await Location.startLocationUpdatesAsync(ACTIVE_RIDE_GPS_TASK, {
        accuracy: Location.Accuracy.Balanced, timeInterval: TARGET_INTERVAL_MS, distanceInterval: 0,
        pausesUpdatesAutomatically: false, deferredUpdatesInterval: TARGET_INTERVAL_MS,
        foregroundService: {
          notificationTitle: 'Sawaari ride in progress',
          notificationBody: 'Location is being used to track your active ride.',
        },
      });
    }
  },
  async reconcile(ride: { id: string; status: string } | null): Promise<void> {
    if (ride?.status === 'in_progress') return this.start(ride.id);
    await this.stop({ flush: false });
  },
  async stop({ flush }: { flush: boolean }): Promise<void> {
    if (flush) await flushPending();
    if (Platform.OS !== 'web' && await Location.hasStartedLocationUpdatesAsync(ACTIVE_RIDE_GPS_TASK)) {
      await Location.stopLocationUpdatesAsync(ACTIVE_RIDE_GPS_TASK);
    }
    await AsyncStorage.multiRemove([CONTEXT_KEY, QUEUE_KEY]);
  },
};
