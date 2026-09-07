import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/.expo/**', '**/coverage/**'] },
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
);
