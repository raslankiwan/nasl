import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      // Node runs our TypeScript by stripping types, which cannot transform a parameter
      // property into a field assignment. Writing one fails at runtime, not at build.
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
    },
  },
  {
    // TypeScript already resolves every identifier, and `no-undef` misfires on type-only names.
    files: ['**/*.ts', '**/*.tsx'],
    rules: { 'no-undef': 'off' },
  },
  {
    files: ['apps/api/**', 'packages/**', '**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/admin/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
