import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Legacy feature panels intentionally keep shared imports/types for
      // optional modules and compatibility paths. Keep these visible as
      // warnings while preventing unused declarations from blocking releases.
      '@typescript-eslint/no-unused-vars': 'warn',
      // ANSI parsers must match ESC/BEL control bytes by design.
      'no-control-regex': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-duplicate-enum-values': 'off',
      // These rules report intentional DOM portal/ref patterns and third-party
      // terminal integration details that React cannot infer safely.
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
