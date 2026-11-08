import type { Config } from 'drizzle-kit';

// Migrations are generated with `pnpm --filter mobile db:generate` and bundled
// into the app through Metro (.sql inlined by Babel). See docs/decisions/S1-storage-migrations.md.
export default {
  schema: './src/**/*.schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
