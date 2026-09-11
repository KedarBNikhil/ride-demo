import { Pressable, StyleSheet, Text, View } from 'react-native';

export function ProductionConfigurationErrorScreen({ onRetry }: { onRetry: () => void }) {
  return <View style={styles.container}><Text style={styles.title}>Configuration error</Text><Text style={styles.message}>Sawaari could not start because required production configuration is unavailable. Please update or reinstall the app.</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.button}><Text style={styles.buttonText}>Retry</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', backgroundColor: '#FFFFFF', flex: 1, justifyContent: 'center', padding: 28 },
  title: { color: '#173B2A', fontSize: 24, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  message: { color: '#455A4E', fontSize: 16, lineHeight: 23, maxWidth: 360, textAlign: 'center' },
  button: { backgroundColor: '#16794A', borderRadius: 10, marginTop: 24, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
