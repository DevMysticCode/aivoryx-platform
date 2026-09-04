import { defineConfig } from 'drizzle-kit';

/**
 * `drizzle-kit generate` only needs the schema (no DB connection).
 * `drizzle-kit migrate` / `studio` read DATABASE_URL from the environment.
 */
export default defineConfig({
  dialect: 'postgresql',
  // Point at the built schema: drizzle-kit's loader resolves real `.js` files
  // cleanly, whereas the NodeNext `.js` specifiers in the TS source trip it up.
  // `db:generate` builds first.
  schema: './dist/schema/index.js',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/aivoryx',
  },
  strict: true,
  verbose: true,
});
