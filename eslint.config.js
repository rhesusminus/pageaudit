import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import unicorn from 'eslint-plugin-unicorn'

const TERMINAL_ONLY =
  'The JSON report and the HTML report stay free of terminal presentation, which lives in src/terminal.js.'

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
      camelcase: ['error', { properties: 'always' }],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'unicorn/filename-case': ['error', { case: 'kebabCase' }]
    }
  },
  {
    files: ['src/report.js', 'src/severity.js', 'src/html/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['chalk', 'cli-table3', 'wrap-ansi'].map((name) => ({ name, message: TERMINAL_ONLY })),
          patterns: [{ group: ['**/terminal.js'], message: TERMINAL_ONLY }]
        }
      ]
    }
  },
  prettier
]
