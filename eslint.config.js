// ==========================================
// 🧹 ESLINT — flat config
// ==========================================
// Covers the three flavours of code in this repo:
//   • src/**/*.js, *.mjs  → Node, ES modules (the bot + CLI scripts)
//   • *.cjs               → Node, CommonJS (deploy / PM2 ecosystem)
//   • web/**/*.js         → browser, classic scripts (claim website)
//
// Run `npm run lint` (or `npm run lint:fix`).

import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        // Runtime data, generated artifacts and third-party code.
        ignores: [
            'node_modules/**',
            'backups/**',
            'logs/**',
            '*.tmp',
        ],
    },

    js.configs.recommended,

    {
        rules: {
            'no-unused-vars': ['error', {
                // Handlers keep call-site-compatible signatures (db /
                // saveLocalStorage / logEvent) that some implementations ignore,
                // and unused bindings are deliberately prefixed with "_".
                args: 'none',
                varsIgnorePattern: '^_',
                caughtErrors: 'none',
            }],
        },
    },

    {
        // Bot + ESM scripts.
        files: ['src/**/*.js', 'src/**/*.mjs', '*.js', '*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
        },
    },

    {
        // Standalone CommonJS scripts (deploy-commands.cjs, ecosystem.config.cjs).
        files: ['**/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
    },

    {
        // Claim website assets — loaded with a plain <script src>, no modules.
        files: ['web/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { ...globals.browser },
        },
    },
];
