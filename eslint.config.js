import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/*.js']
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        Buffer: 'readonly',
        Response: 'readonly',
        clearTimeout: 'readonly',
        customElements: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      'import/no-unresolved': 'off',
      'import/order': [
        'error',
        {
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc'
          }
        }
      ],
      'no-console': [
        'error',
        {
          allow: ['warn', 'error']
        }
      ],
      'react/react-in-jsx-scope': 'off'
    }
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    languageOptions: {
      globals: {
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        vi: 'readonly'
      }
    }
  }
];
