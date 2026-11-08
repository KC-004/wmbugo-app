/**
 * wmbugo core: pure TypeScript domain logic.
 *
 * Boundary: this package must never import react-native, drizzle-orm or
 * @op-engineering/op-sqlite. ESLint (no-restricted-imports) and the
 * tsconfig `paths` stubs both enforce this.
 */
export const CORE_PACKAGE = '@wmbugo/core';
