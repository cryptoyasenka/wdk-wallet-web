/**
 * `createWdkAdapter()` — picks the seed-isolation strategy for the host.
 *
 * The real WDK logic lives in `wdk-core.ts` (the `@tetherto/*` site). This
 * file deliberately imports no `@tetherto/*`: in a browser it spawns the
 * Dedicated Web Worker and returns a postMessage proxy, so the alpha WDK +
 * sodium + BTC stub all bundle into the *worker* chunk and the main bundle
 * stays WDK-free. On Node/SSR (no Worker global — vitest of the real adapter,
 * server rendering) it lazily loads `WdkCoreAdapter` and runs WDK in-process:
 * identical behaviour, no isolation, stated not faked (there is no worker
 * concept off the browser). The `import()` is dynamic so the browser branch
 * never pulls `@tetherto/*` into the main chunk.
 *
 * See docs/ARCHITECTURE.md → ADR-004 and docs/SECURITY.md for the honest limit.
 */
import type { WdkAdapter } from "./types.js";
import { WorkerWdkAdapter } from "./worker-proxy.js";

export async function createWdkAdapter(): Promise<WdkAdapter> {
  if (typeof Worker !== "undefined") {
    const worker = new Worker(new URL("./crypto.worker.js", import.meta.url), {
      type: "module",
    });
    return new WorkerWdkAdapter(worker);
  }
  const { WdkCoreAdapter } = await import("./wdk-core.js");
  return new WdkCoreAdapter();
}
