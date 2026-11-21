import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { classifyStartupFailure, type SafeModeVariant, type StartupErrorCode } from '@wmbugo/core';
import { SafeModeScreen } from './SafeModeScreen';

/**
 * What a failed start shows (Story 8.12): it asks the file system and the Keystore why, then shows the matching safe-mode screen.
 * Until it knows it shows an empty frame, never a spinner. `describe` is injected so tests do not touch the Keystore.
 */
export function StartFailure({
  code,
  onRetry,
  describe,
}: {
  code: StartupErrorCode;
  onRetry: () => void;
  describe?: (code: StartupErrorCode) => Promise<SafeModeVariant>;
}) {
  const [variant, setVariant] = useState<SafeModeVariant | null>(null);
  useEffect(() => {
    let live = true;
    const ask = describe ?? (async (c: StartupErrorCode) => (await import('../../adapters/safeMode')).describeStartupFailure(c));
    void ask(code).then(
      (v) => live && setVariant(v),
      // If the storage cannot even be asked, the code alone decides: a rolled-back migration, otherwise unreadable.
      () => live && setVariant(classifyStartupFailure(code, { databaseExists: false, keyMissing: false })),
    );
    return () => {
      live = false;
    };
  }, [code, describe]);
  if (variant === null) return <View style={styles.fill} testID="start-failure-pending" />;
  return <SafeModeScreen variant={variant === 'readable' ? 'unreadable' : variant} onRetry={onRetry} />;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
