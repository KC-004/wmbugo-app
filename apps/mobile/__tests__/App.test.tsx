/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { Result, StartupErrorCode, StartupOk } from '@wmbugo/core';
import App from '../App';

// SafeAreaProvider renders nothing until native insets arrive; use the library mock.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
  require('react-native-safe-area-context/jest/mock').default,
);
// The real startup touches Keystore, SQLCipher and the file system.
jest.mock('../src/adapters/startApp', () => ({ startApp: jest.fn() }));

const dbStub = {} as StartupOk['db'];
const ready = (route: 'home' | 'onboarding'): Result<StartupOk, StartupErrorCode> => ({ ok: true, value: { db: dbStub, route } });

async function render(start: () => Promise<Result<StartupOk, StartupErrorCode>>) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App start={start} />);
  });
  return renderer;
}

const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.children === 'string').map((n) => n.props.children as string);

test('shows the app shell (tabs and Home header) when a profile exists', async () => {
  const r = await render(() => Promise.resolve(ready('home')));
  expect(texts(r)).toContain('Home');
  expect(r.root.findAll((n) => typeof n.type === 'string' && (n.props.testID === 'tab-bar' || n.props.testID === 'nav-rail')).length).toBe(1); // Jest's default window is wide, so the rail
});

test('routes to onboarding when no profile exists', async () => {
  const r = await render(() => Promise.resolve(ready('onboarding')));
  expect(texts(r)).toContain('Welcome to wmbugo');
});

test('shows nothing (and no spinner) until startup resolves, then the screen', async () => {
  let resolve!: (v: Result<StartupOk, StartupErrorCode>) => void;
  const pending = new Promise<Result<StartupOk, StartupErrorCode>>((res) => {
    resolve = res;
  });
  const r = await render(() => pending);
  expect(r.root.findAllByProps({ testID: 'startup-pending' }).length).toBeGreaterThan(0);
  expect(texts(r)).toEqual([]);
  expect(JSON.stringify(r.toJSON())).not.toMatch(/ActivityIndicator/);
  await ReactTestRenderer.act(async () => {
    resolve(ready('home'));
  });
  expect(texts(r)).toContain('Home');
});

test.each<StartupErrorCode>(['STORAGE_UNSAFE', 'KEY_UNAVAILABLE', 'DATABASE_OPEN_FAILED', 'MIGRATION_FAILED'])(
  'shows the inline storage error for %s',
  async (code) => {
    const r = await render(() => Promise.resolve({ ok: false, code }));
    expect(texts(r)).toEqual(["wmbugo couldn't open its secure storage. Nothing was changed."]);
    expect(r.root.findAllByProps({ accessibilityRole: 'alert' }).length).toBeGreaterThan(0);
  },
);

test('a startup that throws shows the same inline error', async () => {
  const r = await render(() => Promise.reject(new Error('boom')));
  expect(texts(r)).toEqual(["wmbugo couldn't open its secure storage. Nothing was changed."]);
});

test('unmounting before startup finishes does not update state', async () => {
  let resolve!: (v: Result<StartupOk, StartupErrorCode>) => void;
  const pending = new Promise<Result<StartupOk, StartupErrorCode>>((res) => {
    resolve = res;
  });
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const r = await render(() => pending);
  await ReactTestRenderer.act(async () => {
    r.unmount();
    resolve(ready('home'));
  });
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
