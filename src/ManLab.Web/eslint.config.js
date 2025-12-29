import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    rules: {
      // shadcn/ui patterns often export variant objects and helpers from component files.
      // This keeps Fast Refresh happy while allowing those constant exports.
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  }
  ,
  {
    // Generated UI primitives frequently export non-component helpers (variants, contexts, etc.).
    // We opt out of this rule for these files to keep lint actionable.
    files: [
      'src/components/ui/**/*.{ts,tsx}',
      'src/components/theme-provider.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  }
])
