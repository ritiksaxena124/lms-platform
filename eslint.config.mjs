import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole workspace. The `no-restricted-syntax` entry is the
 * machine-checked half of the soft-delete rule: rows are deactivated with `isActive`,
 * never removed, so a `delete`/`deleteMany` call is a bug rather than a style opinion.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/coverage/**', 'storage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression > MemberExpression[property.name=/^(delete|deleteMany|truncate|dropTable)$/]:not([computed])',
          message:
            'Hard deletes are not allowed. Soft-deactivate with isActive (and deletedAt); see ARCHITECTURE.md.',
        },
        {
          selector: "CallExpression[callee.name='require']",
          message: 'Use ES module imports; require() hides dependencies from the bundler.',
        },
      ],
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
  {
    // NestJS reads constructor parameter types at runtime via emitDecoratorMetadata, so
    // an injectable must stay a value import. `import type` here compiles to "no import"
    // and DI fails with `can't resolve dependencies of the X (?)`.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'consistent-type-imports': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    // The logger is the one app-level writer to stdout, and a `*-cli.ts` script exists
    // only to report to a terminal — neither should have to inject a logger to say "done".
    files: ['apps/api/src/common/logging/**/*.ts', 'apps/api/src/**/*-cli.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', 'apps/api/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': 'off',
    },
  },
  // Every portal is React with hooks and effects that talk to the API; these are the
  // rules that catch the bugs a type checker cannot see.
  ...reactHooks.configs['recommended-latest'],
);
