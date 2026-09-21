import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/', '.jojo-claw/', '**/*.test.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      complexity: ['error', 20],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
      'max-len': ['error', { code: 100, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
      'max-nested-callbacks': ['error', 2],
      'max-params': ['error', 4],
      'max-statements': ['error', 30],
    },
  },
)
