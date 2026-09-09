import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Keep the app-owned tab content compact. Android's navigation inset is added
// outside this height so it never becomes an artificial spacer.
export const bottomTabContentHeight = 60;

export function useBottomTabBarMetrics() {
  const insets = useSafeAreaInsets();
  return {
    bottomInset: insets.bottom,
    tabBarHeight: bottomTabContentHeight + insets.bottom,
  };
}
