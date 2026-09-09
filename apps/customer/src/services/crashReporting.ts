import Constants from 'expo-constants';
import { Platform } from 'react-native';

const isExpoGo = Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo';

/**
 * Crashlytics has its own global fatal-JS handler. This bootstrap only adds
 * immutable release context and never turns a reporting failure into an app
 * failure (notably when developing in Expo Go, which has no native module).
 */
export function configureCrashReporting() {
  if (Platform.OS !== 'android' || isExpoGo) return;
  try {
    const Crashlytics = require('@react-native-firebase/crashlytics') as typeof import('@react-native-firebase/crashlytics');
    const instance = Crashlytics.getCrashlytics();
    void Crashlytics.setAttributes(instance, {
      app_role: 'customer',
      expo_project_id: '1158ff7e-1da5-4a6a-9080-14791394da7a',
      runtime_version: 'customer-1.0.2',
    });
  } catch {
    // Reporting is observability only and must not affect boot safety.
  }
}
