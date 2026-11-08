/**
 * Placeholder root. Navigation and features arrive in later stories.
 * The only logic here is the theme and the startup gate: the first screen waits for the
 * encrypted database to be ready.
 */
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startApp } from './src/adapters/startApp';
import { StartupGate, type StartFn } from './src/features/startup/StartupGate';
import { copy } from './src/shared/copy';
import { queryClient } from './src/shared/queryClient';
import { textStyle, ThemeProvider, useTheme } from './src/shared/theme';

function Screen({ route }: { route: 'home' | 'onboarding' }) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.color('bg-canvas') }]}>
      {/* Edge-to-edge (target SDK 36): the bar is transparent, so only the icon style follows the theme. */}
      <StatusBar barStyle={theme.scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <Text accessibilityRole="header" style={[textStyle('title'), { color: theme.color('text-primary') }]}>
        {route === 'onboarding' ? copy.onboarding.placeholder : copy.app.name}
      </Text>
    </View>
  );
}

function App({ start = startApp }: { start?: StartFn }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <StartupGate start={start}>{(route) => <Screen route={route} />}</StartupGate>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default App;
