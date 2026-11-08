/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// SafeAreaProvider renders nothing until native insets arrive; use the library mock.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use import
  require('react-native-safe-area-context/jest/mock').default,
);

test('renders the wmbugo placeholder', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  const matches = renderer!.root.findAll(
    (node) => typeof node.type === 'string' && node.props.children === 'wmbugo',
  );
  expect(matches.length).toBeGreaterThan(0);
});
