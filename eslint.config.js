import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'data/**', 'logs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    // reactHooks v7 flat config: plugins is an object { 'react-hooks': pluginRef }
    plugins: reactHooks.configs.flat.recommended.plugins,
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
);
