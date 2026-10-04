import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import unicorn from 'eslint-plugin-unicorn'

export default [
  { ignores: ['node_modules', 'dist', 'coverage'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node
    }
  },
  {
    plugins: { unicorn },
    rules: {
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'unicorn/filename-case': ['error', { case: 'kebabCase' }]
    }
  },
  prettier
]
