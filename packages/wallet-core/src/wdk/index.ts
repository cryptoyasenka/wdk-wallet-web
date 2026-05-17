/**
 * Public face of the WDK containment layer.
 *
 * The engine imports `createWdkAdapter` and the interfaces from here — never
 * `@tetherto/*` directly. This re-export is what the ESLint
 * `no-restricted-imports` rule lets the rest of the codebase touch.
 */
export { createWdkAdapter } from "./adapter.js";
export type * from "./types.js";
