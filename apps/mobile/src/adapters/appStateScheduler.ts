import { AppState } from 'react-native';
import type { Scheduler } from '@wmbugo/core';

/** Runs the task now and every time the app comes back to the foreground. A background trigger can implement the same port later. */
export const appStateScheduler: Scheduler = {
  onStartOrResume(task) {
    const run = () => {
      void Promise.resolve()
        .then(task)
        .catch(() => undefined);
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => sub.remove();
  },
};
