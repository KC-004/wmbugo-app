// Boundary guard stub. packages/core/tsconfig.json maps 'react-native' here.
// Reaching this file means core imported 'react-native', which is forbidden.
// The deliberate type error below makes `pnpm typecheck` fail with the message.
type BoundaryViolation =
  'Boundary: packages/core must not import react-native (core is pure TypeScript; use apps/mobile adapters behind a core port)';
const violation: BoundaryViolation = 'react-native';
export default violation;
