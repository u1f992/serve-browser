import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * @see https://typescript-eslint.io/getting-started/
 * @see https://eslint.org/docs/latest/use/configure/migration-guide#configure-language-options
 */
export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
