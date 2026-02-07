import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'node_modules/',
      '*.config.js',
      'coverage/',
      'supabase/',
      '**/__tests__/**',
      'src/vendor/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.node.json'],
      },
    },
    rules: {
      // TypeScript specific
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/consistent-type-exports': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        fabric: 'readonly',
      },
    },
    rules: {
      // JS specific overrides if needed
      'no-console': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'prefer-const': 'off',
      'no-inner-declarations': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    // General rules for all files
    rules: {
      'no-console': 'off',
      'prefer-const': 'off',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  prettier
);
