import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      // G11: No console.log in committed code
      "no-console": ["error", { allow: ["error"] }],
      // Prefer unknown over any
      "@typescript-eslint/no-explicit-any": "warn",
      // Unused vars — allow underscore prefix for intentional ignores
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Empty catch blocks are intentional (G10 silent failures)
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "*.js", "*.mjs"],
  }
);

