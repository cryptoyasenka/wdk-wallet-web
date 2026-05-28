import { describe, it, expect } from "vitest";
import { WorkerWdkAdapter } from "../src/wdk/worker-proxy.js";

/**
 * The worker proxy must never leave an RPC promise hanging when its Web Worker
 * dies. A crash (`onerror`) or a reply that fails structured-clone
 * (`onmessageerror`) rejects every in-flight call and latches the failure, so
 * later calls fail fast instead of waiting on a worker that will never answer
 * (a frozen unlock/send with no surfaced error). The real postMessage
 * round-trip is browser-only; a fake Worker drives the error edges
 * deterministically under vitest's node environment.
 */
class FakeWorker {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  /** Records the request but never replies — calls stay pending until we kill it. */
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
}

function makeAdapter() {
  const worker = new FakeWorker();
  const adapter = new WorkerWdkAdapter(worker as unknown as Worker);
  return { worker, adapter };
}

describe("WorkerWdkAdapter worker-death handling", () => {
  it("rejects all in-flight calls when the worker crashes (onerror)", async () => {
    const { worker, adapter } = makeAdapter();
    const a = adapter.generateSeedPhrase();
    const b = adapter.isValidSeedPhrase("x");
    expect(worker.posted).toHaveLength(2); // both dispatched, neither answered

    worker.onerror?.({ message: "boom" } as ErrorEvent);

    await expect(a).rejects.toThrow(/boom/);
    await expect(b).rejects.toThrow(/boom/);
  });

  it("fails fast on calls made after the worker has died", async () => {
    const { worker, adapter } = makeAdapter();
    worker.onerror?.({ message: "boom" } as ErrorEvent);
    await expect(adapter.generateSeedPhrase()).rejects.toThrow(/boom/);
  });

  it("rejects pending calls on an undeserializable message (onmessageerror)", async () => {
    const { worker, adapter } = makeAdapter();
    const p = adapter.generateSeedPhrase();
    worker.onmessageerror?.({} as MessageEvent);
    await expect(p).rejects.toThrow(/undeserializable/);
  });

  it("latches the first failure reason and does not overwrite it", async () => {
    const { worker, adapter } = makeAdapter();
    worker.onerror?.({ message: "first" } as ErrorEvent);
    worker.onmessageerror?.({} as MessageEvent); // must not replace "first"
    await expect(adapter.generateSeedPhrase()).rejects.toThrow(/first/);
  });
});
