// Boundary guard stub. packages/core/tsconfig.json maps '@op-engineering/op-sqlite' here.
// Reaching this file means core imported '@op-engineering/op-sqlite', which is forbidden.
// The deliberate type error below makes `pnpm typecheck` fail with the message.
type BoundaryViolation =
  'Boundary: packages/core must not import @op-engineering/op-sqlite (core is pure TypeScript; use apps/mobile adapters behind a core port)';
const violation: BoundaryViolation = '@op-engineering/op-sqlite';
export default violation;
