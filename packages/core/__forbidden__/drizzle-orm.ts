// Boundary guard stub. packages/core/tsconfig.json maps 'drizzle-orm' here.
// Reaching this file means core imported 'drizzle-orm', which is forbidden.
// The deliberate type error below makes `pnpm typecheck` fail with the message.
type BoundaryViolation =
  'Boundary: packages/core must not import drizzle-orm (core is pure TypeScript; use apps/mobile adapters behind a core port)';
const violation: BoundaryViolation = 'drizzle-orm';
export default violation;
