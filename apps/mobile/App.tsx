/**
 * Root. The startup gate holds the first screen until the encrypted database is ready, then routes:
 * no profile goes to onboarding, a profile goes to the app shell. Finishing onboarding writes the profile
 * (SetUpProfile) and opens Home.
 */
import { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { detectRegion, type Region, type SetUpProfileInput } from '@wmbugo/core';
import { setUpProfile, startApp, systemClock } from './src/adapters/startApp';
import { OnboardingFlow } from './src/features/onboarding/OnboardingFlow';
import { RootNavigator } from './src/features/shell/RootNavigator';
import { StartupGate, type StartFn } from './src/features/startup/StartupGate';
import { queryClient } from './src/shared/queryClient';
import { readDeviceRegion, ThemeProvider, useTheme } from './src/shared/theme';

type SetUpFn = (input: SetUpProfileInput) => Promise<boolean>;

function Onboarding({ onDone, setUp }: { onDone: () => void; setUp: SetUpFn }) {
  const theme = useTheme();
  const [detected, setDetected] = useState<{ region: Region | null } | null>(null);
  useEffect(() => {
    let live = true;
    void readDeviceRegion().then((code) => live && setDetected({ region: detectRegion(code) }));
    return () => {
      live = false;
    };
  }, []);
  if (detected === null) return <View style={[styles.fill, { backgroundColor: theme.color('bg-canvas') }]} />;
  return (
    <View style={styles.fill}>
      {/* Edge-to-edge (target SDK 36): the bar is transparent, so only the icon style follows the theme. */}
      <StatusBar barStyle={theme.scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <OnboardingFlow
        detected={detected.region}
        timezoneId={systemClock.timezoneId()}
        onFinish={async (input) => {
          const ok = await setUp(input);
          if (ok) onDone();
          return ok;
        }}
      />
    </View>
  );
}

function Screen({ route, setUp }: { route: 'home' | 'onboarding'; setUp: SetUpFn }) {
  const [done, setDone] = useState(false);
  if (route === 'home' || done) return <RootNavigator />;
  return <Onboarding onDone={() => setDone(true)} setUp={setUp} />;
}

function App({ start = startApp, setUp = setUpProfile }: { start?: StartFn; setUp?: SetUpFn }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SafeAreaProvider>
          <StartupGate start={start}>{(route) => <Screen route={route} setUp={setUp} />}</StartupGate>
        </SafeAreaProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});

export default App;
