/**
 * Placeholder root. Navigation, theming and features arrive in later stories.
 */
import { StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.container}>
        <Text
          accessibilityRole="header"
          style={[styles.title, isDarkMode ? styles.titleDark : styles.titleLight]}>
          wmbugo
        </Text>
      </View>
    </SafeAreaProvider>
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
