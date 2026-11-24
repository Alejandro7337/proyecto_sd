// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-*/*', 'coverage/*'],
  },
  {
    files: ['__tests__/**/*.js'],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
  },
]);
