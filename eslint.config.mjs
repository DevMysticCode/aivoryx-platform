// Flat ESLint config for the Aivoryx monorepo.
// Module boundaries are enforced with no-restricted-imports pattern groups
// (see docs/adr/0003 + docs/adr/0024). Keep the layering rules in sync with
// packages/*/package.json dependencies.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';

const appsCannotImport = (patterns) => ({
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: patterns.map((group) => ({
          group: group.group,
          message: group.message,
        })),
      },
    ],
  },
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/node_modules/**',
      'packages/contracts/src/generated/**',
      'packages/db/drizzle/**',
      '**/*.config.js',
      '**/*.config.cjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  // ---- Module boundary rules -------------------------------------------------

  // packages/shared: leaf package, no internal dependencies.
  {
    files: ['packages/shared/**/*.{ts,tsx}'],
    ...appsCannotImport([
      {
        group: ['@aivoryx/config', '@aivoryx/db', '@aivoryx/contracts', '@aivoryx/ui'],
        message:
          'packages/shared is a leaf package and must not depend on other workspace packages.',
      },
      { group: ['**/apps/**'], message: 'packages must never import from apps.' },
    ]),
  },

  // packages/config: may only depend on shared.
  {
    files: ['packages/config/**/*.{ts,tsx}'],
    ...appsCannotImport([
      {
        group: ['@aivoryx/db', '@aivoryx/contracts', '@aivoryx/ui'],
        message: 'packages/config may only depend on @aivoryx/shared.',
      },
      { group: ['**/apps/**'], message: 'packages must never import from apps.' },
    ]),
  },

  // packages/db: may depend on shared + config only.
  {
    files: ['packages/db/**/*.{ts,tsx}'],
    ...appsCannotImport([
      {
        group: ['@aivoryx/contracts', '@aivoryx/ui'],
        message: 'packages/db may only depend on @aivoryx/shared and @aivoryx/config.',
      },
      { group: ['**/apps/**'], message: 'packages must never import from apps.' },
      {
        group: ['@nestjs/*', 'next', 'next/*', 'react'],
        message: 'packages/db must stay framework-agnostic.',
      },
    ]),
  },

  // packages/contracts: may depend on shared only.
  {
    files: ['packages/contracts/**/*.{ts,tsx}'],
    ...appsCannotImport([
      {
        group: ['@aivoryx/db', '@aivoryx/config', '@aivoryx/ui'],
        message: 'packages/contracts may only depend on @aivoryx/shared.',
      },
      { group: ['**/apps/**'], message: 'packages must never import from apps.' },
    ]),
  },

  // packages/ui: may depend on shared only; browser/React land.
  {
    files: ['packages/ui/**/*.{ts,tsx}'],
    ...appsCannotImport([
      {
        group: ['@aivoryx/db', '@aivoryx/config', '@aivoryx/contracts'],
        message: 'packages/ui may only depend on @aivoryx/shared.',
      },
      { group: ['**/apps/**'], message: 'packages must never import from apps.' },
      { group: ['@nestjs/*'], message: 'packages/ui is a browser package.' },
    ]),
  },

  // apps/api: server only. No UI package, no Next, no reaching into the web app.
  {
    files: ['apps/api/**/*.{ts,tsx}'],
    ...appsCannotImport([
      { group: ['@aivoryx/ui'], message: 'apps/api must not import the browser UI package.' },
      { group: ['next', 'next/*', 'react', 'react-dom'], message: 'apps/api is not a React app.' },
      {
        group: ['**/apps/web/**'],
        message: 'apps must not import each other; use @aivoryx/contracts.',
      },
    ]),
  },
  {
    // NestJS relies on runtime imports for DI + decorator metadata; forcing
    // `import type` would strip metadata and break the container.
    files: ['apps/api/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },

  // apps/web: browser/Next only. No NestJS, no direct DB, no reaching into the API app.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...appsCannotImport([
      { group: ['@nestjs/*'], message: 'apps/web must not import NestJS.' },
      {
        group: ['@aivoryx/db', '@aivoryx/db/*', 'drizzle-orm', 'pg', 'ioredis', 'bullmq'],
        message: 'apps/web must not access the database or queues directly; call the API.',
      },
      {
        group: ['**/apps/api/**'],
        message: 'apps must not import each other; use @aivoryx/contracts.',
      },
    ]),
  },

  // Next.js app rules.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  // Test files: relax a few rules.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/test/**/*.{ts,tsx}', '**/e2e/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Config / script files (Node runtime, plain JS globals).
  {
    files: ['**/*.config.{ts,mts,mjs}', '**/scripts/**/*.{ts,mjs}', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  prettier,
);
