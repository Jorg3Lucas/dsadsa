import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // === ERRORS ===
      "no-useless-assignment": "off", // experimental — false positives on counter pattern (let x = 0; x++;)
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
      "no-undef": "error",
      "no-console": "off",           // console.log is used heavily — intentional
      "prefer-const": "warn",        // encourage const over let
      "no-var": "error",            // ban var
      "eqeqeq": ["warn", "smart"],  // warn on ==/!= (but allow == null)
      "no-unused-expressions": "warn",

      // === IMPORT ===
      "no-duplicate-imports": "warn",

      // === BEST PRACTICE ===
      "curly": ["warn", "multi-line"],
      "no-throw-literal": "error",
      "prefer-promise-reject-errors": "warn",
    },
  },
  {
    // Tests / config files — allow dev patterns
    files: ["**/*.config.js", "**/*.config.mjs"],
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
  {
    // Ignore patterns
    ignores: [
      "node_modules/",
      "*.json",
      "ticket-logs/",
    ],
  },
];
