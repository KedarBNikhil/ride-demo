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
      app_role: 'captain',
      expo_project_id: '6acc15fd-28b0-4f3a-b825-7e8e5d05cc13',
      runtime_version: 'captain-1.0.3',
    });
  } catch {
    // Reporting is observability only and must not affect boot safety.
  }
}
