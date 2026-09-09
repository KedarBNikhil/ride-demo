import { useFonts, NotoSansTelugu_400Regular, NotoSansTelugu_700Bold, NotoSansTelugu_800ExtraBold } from '@expo-google-fonts/noto-sans-telugu';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/config/appVariant';
import { configureCrashReporting } from './src/services/crashReporting';
import { CustomerAppNavigator } from './src/navigation/CustomerAppNavigator';

configureCrashReporting();

export default function App() {
  const [fontsLoaded] = useFonts({
    NotoSansTelugu: NotoSansTelugu_400Regular,
    'NotoSansTelugu-Bold': NotoSansTelugu_700Bold,
    'NotoSansTelugu-ExtraBold': NotoSansTelugu_800ExtraBold,
  });
  if (!fontsLoaded) return null;
  return <SafeAreaProvider><StatusBar style="light" /><CustomerAppNavigator /></SafeAreaProvider>;
}
