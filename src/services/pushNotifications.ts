import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';

// Expo Go does not provide this project's native push configuration. Avoid
// importing the native notifications module there so realtime testing works.
const isExpoGo = Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';

export async function registerPushNotifications(appVariant: 'customer' | 'captain') {
  if (!supabase || isExpoGo) return null;
  const Device = require('expo-device') as typeof import('expo-device');
  const Notifications = require('expo-notifications') as typeof import('expo-notifications');
  if (!Device.isDevice) return null;
  Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.status === 'granted'
    ? existing
    : await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;

  await Notifications.setNotificationChannelAsync('ride-updates', {
    name: 'Ride updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 180, 250],
    sound: 'default',
  });

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('EAS_PROJECT_ID_MISSING');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await supabase.rpc('register_push_device', {
    p_expo_push_token: token,
    p_platform: 'android',
    p_app_variant: appVariant,
  });
  if (error) throw error;
  return token;
}
