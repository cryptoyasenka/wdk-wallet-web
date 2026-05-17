// Flat ESLint config for the wdk-wallet-web monorepo.
//
// The load-bearing rule here is the @tetherto/* containment guard: alpha WDK
// may be imported ONLY under packages/wallet-core/src/wdk/. Everything else —
// the engine, the apps, the tests — depends on the hand-written adapter
// interfaces, so a breaking WDK release has a one-folder blast radius. CI runs
// `pnpm lint`, so this is enforced, not just documented.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

const TETHER_BAN = {
  patterns: [
    {
      group: ["@tetherto/*", "@tetherto/**"],
      message:
        "Import @tetherto/* ONLY in packages/wallet-core/src/wdk/ (alpha-churn containment). " +
        "Everywhere else, depend on the WdkAdapter interface from src/wdk/index.js.",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/coverage/**",
      // Next-generated, "should not be edited"; it carries a triple-slash
      // path reference that @typescript-eslint/triple-slash-reference flags.
      "**/next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-restricted-imports": ["error", TETHER_BAN],
      "@typescript-eslint/no-restricted-imports": ["error", TETHER_BAN],
      // Convention: a leading underscore marks an intentionally-unused binding
      // (e.g. an interface-mandated parameter the impl does not need).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },

  // The containment layer is the one place @tetherto/* is allowed.
  {
    files: ["packages/wallet-core/src/wdk/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": "off",
    },
  },

  // React hooks correctness for the Next.js app (catches real bugs:
  // conditional hooks, stale-closure dep arrays).
  {
    files: ["apps/next/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
