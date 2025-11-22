module.exports = {
  env: {
    browser: true,
  },
  extends: ['plugin:react/recommended', 'plugin:import/typescript', 'plugin:prettier/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['unused-imports', 'simple-import-sort'],
  rules: {
    '@typescript-eslint/no-empty-interface': 0,
    '@typescript-eslint/explicit-module-boundary-types': 0,
    '@typescript-eslint/no-empty-function': 0,
    '@typescript-eslint/no-explicit-any': 0,
    '@typescript-eslint/no-var-requires': 0,
    'react/react-in-jsx-scope': 0,
    'react/prop-types': 0,
    'unused-imports/no-unused-imports': 'warn',
    'unused-imports/no-unused-vars': [
      'off',
      { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
    ],
    'simple-import-sort/imports': [
      'warn',
      {
        groups: [['^react', '^antd', '^@?\\w', '@/(.*)', '^[./]']],
      },
    ],
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
