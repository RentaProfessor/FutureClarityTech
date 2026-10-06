import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', '.wrangler/'] },
  js.configs.recommended,
  // the page: ES modules in the browser
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser } },
  // Cloudflare Pages Functions run in a Worker
  { files: ['functions/**/*.js'], languageOptions: { globals: globals.serviceworker } },
  // build scripts and tests run in Node (and the e2e tests also script the page)
  { files: ['scripts/**/*.mjs', 'tests/**/*.js', '*.config.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] } },
];
