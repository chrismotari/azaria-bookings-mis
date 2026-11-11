// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    rules: {
      // Apostrophes in <Text> are plain text in React Native.
      'react/no-unescaped-entities': 'off',
      // Default imports are how axios and Tiptap are meant to be used.
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      // React Compiler rules; the app does not use the React Compiler.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/incompatible-library': 'off',
    },
  },
]);
