import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Result, StartRoute, StartupErrorCode, StartupOk } from '@wmbugo/core';
import { copy } from '../../shared/copy';

export type StartFn = () => Promise<Result<StartupOk, StartupErrorCode>>;

type State =
  | { status: 'pending' }
  | { status: 'error'; code: StartupErrorCode }
  | { status: 'ready'; route: StartRoute };

/**
 * Holds the first screen until the key is loaded and the first query returned,
 * never on a timer and never with a spinner. On failure it shows an inline
 * error and nothing else happens: no write was made by the failing step.
 */
export function StartupGate({ start, children }: { start: StartFn; children: (route: StartRoute) => ReactNode }) {
  const [state, setState] = useState<State>({ status: 'pending' });

  useEffect(() => {
    let cancelled = false;
    start()
      .then((r) => {
        if (cancelled) return;
        setState(r.ok ? { status: 'ready', route: r.value.route } : { status: 'error', code: r.code });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', code: 'DATABASE_OPEN_FAILED' });
      });
    return () => {
      cancelled = true;
    };
  }, [start]);

  if (state.status === 'pending') return <View style={styles.fill} testID="startup-pending" />;
  if (state.status === 'error') {
    return (
      <View style={styles.center} testID="startup-error">
        <Text accessibilityRole="alert" style={styles.message}>
          {copy.startup.storageError}
        </Text>
      </View>
    );
  }
  return <>{children(state.route)}</>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { fontSize: 16, textAlign: 'center' },
});
