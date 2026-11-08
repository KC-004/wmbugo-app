/**
 * Placeholder root. Navigation, theming and features arrive in later stories.
 * The only logic here is the startup gate: the first screen waits for the
 * encrypted database to be ready.
 */
import { StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startApp } from './src/adapters/startApp';
import { StartupGate, type StartFn } from './src/features/startup/StartupGate';
import { copy } from './src/shared/copy';
import { queryClient } from './src/shared/queryClient';

function App({ start = startApp }: { start?: StartFn }) {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <QueryClientProvider client={queryClient}>
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <StartupGate start={start}>
        {(route) => (
          <View style={styles.container}>
            <Text
              accessibilityRole="header"
              style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>
              {route === 'onboarding' ? copy.onboarding.placeholder : copy.app.name}
            </Text>
          </View>
        )}
      </StartupGate>
    </SafeAreaProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '600',
  },
  // Named colours only: design tokens arrive in Story 1.8.
  titleLight: { color: 'black' },
  titleDark: { color: 'white' },
});

export default App;
