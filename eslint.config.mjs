// @ts-check
import {defineConfig, globalIgnores} from 'eslint/config';
import expoConfig from 'eslint-config-expo/flat.js';

export default defineConfig([
  expoConfig,
  // Generated / third-party output is never linted.
  globalIgnores(['dist/*', '.expo/*', 'android/*', 'ios/*']),
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
      },
    },
  },
]);
