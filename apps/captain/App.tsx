import { useFonts, NotoSansTelugu_400Regular, NotoSansTelugu_700Bold, NotoSansTelugu_800ExtraBold } from '@expo-google-fonts/noto-sans-telugu';
import { lazy, Suspense, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import './src/config/appVariant';
import { getProductionConfigStatus } from './src/config/productionConfig';
import { ProductionConfigurationErrorScreen } from './src/components/ProductionConfigurationErrorScreen';
import { configureCrashReporting } from './src/services/crashReporting';

const CaptainAppNavigator = lazy(async () => {
  await import('./src/services/activeRideGpsTracking');
  const module = await import('./src/navigation/CaptainAppNavigator');
  return { default: module.CaptainAppNavigator };
});

configureCrashReporting();

export default function App() {
  const [productionConfigStatus, setProductionConfigStatus] = useState(getProductionConfigStatus);
  const [fontsLoaded] = useFonts({
    NotoSansTelugu: NotoSansTelugu_400Regular,
    'NotoSansTelugu-Bold': NotoSansTelugu_700Bold,
    'NotoSansTelugu-ExtraBold': NotoSansTelugu_800ExtraBold,
  });
  if (!productionConfigStatus.ok) return <ProductionConfigurationErrorScreen onRetry={() => setProductionConfigStatus(getProductionConfigStatus())} />;
  if (!fontsLoaded) return null;
  return <SafeAreaProvider><StatusBar style="light" /><Suspense fallback={null}><CaptainAppNavigator /></Suspense></SafeAreaProvider>;
}
