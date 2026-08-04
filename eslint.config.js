import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: [
            'node_modules/**',
            'backups/**',
            '*.json',
            '*.tmp'
        ]
    },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node
            }
        },
        rules: {
            // Allow console.* (bot is heavily log-based)
            'no-console': 'off',
            // Unused variables/imports — warn (keep within the --max-warnings budget)
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // Empty catch blocks are intentional throughout the bot
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Tests legitimately reassign imported singletons (pendingRegistrations etc.) to reset state
            'no-import-assign': 'off',
            // cleanNickname intentionally uses a complex character class (emoji/formatting chars)
            'no-useless-escape': 'off',
            'no-misleading-character-class': 'off',
            // sync-engine uses `false && ...` as intentional feature kill-switches (disabled DMs)
            'no-constant-condition': 'off',
            'no-constant-binary-expression': 'off'
        }
    },
    {
        files: ['**/*.cjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                ...globals.node
            }
        },
        rules: {
            'no-console': 'off',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    }
];
