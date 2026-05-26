// Permanent end-to-end smoke test — `pnpm smoke`.
//
// This is the manual reviewer walkthrough, automated and repeatable. Like the
// demo recorder it is tooling, NOT the wallet: it lives outside the pnpm
// workspace, never imports @tetherto/* or @wdk-web/wallet-core, and is not
// touched by the lint / typecheck / test / build quartet. It builds the real
// headless core + the real production Next app and drives the real client-side
// wallet through a browser.
//
// Flows asserted (exit 1 on any failure):
//   A. walletFlow — create wallet with a passphrase; back up the seed + pass the
//      seed quiz; land on the portfolio; the receive card exposes an accessible
//      "Copy … receive address" control (real client-side key derivation, no
//      network); the Request tab mounts the EIP-681/BIP-21 payment-request
//      builder (Phase 1); Recovery Check re-verifies the passphrase without
//      re-exposing the seed.
//   B. watchOnlyFlow — a fresh (wallet-less) context watches an external EVM
//      address and the read-only view disables signing (Phase 5).
//
// Deliberately NETWORK-INDEPENDENT: BTC is left unconfigured (no Electrum-WS
// endpoint) so the registry honestly omits it, and the assertions hang on UI
// that derives addresses/decrypts the vault locally — not on public RPC reads,
// which would make the smoke flaky. (The demo recorder, which needs live
// balances, is the network-touching counterpart.)
//
// Prereq (one-time): corepack pnpm exec playwright install chromium

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", ".."); // repo root (tools/e2e → repo)
const NEXT_DIR = join(ROOT, "apps", "next");

const IS_WIN = process.platform === "win32";
/** Spawned children we must reap even if a step throws. */
const children = [];

function run(cmd, { cwd = ROOT, env = process.env } = {}) {
  // shell:true so `corepack` resolves on Windows (corepack.cmd) and POSIX.
  const child = spawn(cmd, { cwd, env, shell: true, stdio: "inherit" });
  children.push(child);
  return child;
}

/** Kill a child and, on Windows, its whole process tree (corepack→pnpm→node). */
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  } catch {
    /* best effort */
  }
}

async function waitForExit(child, label) {
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(`${label} exited with code ${code}`);
}

/** Ask the OS for a free TCP port, then release it for the server to claim. */
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(800);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function completeSeedQuiz(page, seedPhrase) {
  await page.getByRole("heading", { name: "Verify your seed phrase" }).waitFor({ timeout: 30000 });
  const words = seedPhrase.trim().split(/\s+/);
  const prompts = await page.locator("p", { hasText: "Word #" }).allTextContents();
  for (const prompt of prompts) {
    const match = prompt.match(/Word #(\d+)/);
    if (!match) continue;
    const word = words[Number(match[1]) - 1];
    if (!word) throw new Error(`Seed quiz asked for missing ${prompt}`);
    await page.getByRole("button", { name: word, exact: true }).click();
  }
  await page.getByRole("button", { name: "Continue" }).click();
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`[smoke] ok — ${msg}`);
}

/** Resolve true as soon as any of the locators becomes visible, else false. */
async function firstVisible(locators, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const loc of locators) {
      if (await loc.isVisible().catch(() => false)) return true;
    }
    await sleep(400);
  }
  return false;
}

const VIEWPORT = { width: 430, height: 1180 };
const PASS = "smoke-passphrase-2026";
// A well-known mainnet address (Ethereum Foundation) — valid EVM shape so the
// watch-only path accepts it. No funds are spent; only public reads happen.
const WATCH_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/** Wallet flow: create -> seed quiz -> portfolio -> receive a11y -> payment request -> Recovery Check. */
async function walletFlow(browser, appUrl) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });

    // Onboarding — Create is the default tab.
    await page.getByRole("button", { name: "Create wallet" }).waitFor({ timeout: 30000 });
    await page.getByLabel("Passphrase (encrypts the vault on this device)").fill(PASS);
    await page.getByLabel("Confirm passphrase").fill(PASS);
    await page.getByRole("button", { name: "Create wallet" }).click();

    // Back up the seed, then pass the quiz.
    await page.getByRole("heading", { name: "Back up your seed phrase" }).waitFor({ timeout: 30000 });
    const seedPhrase = (await page.locator("pre").first().innerText()).trim();
    assert(seedPhrase.split(/\s+/).length >= 12, "seed phrase has >= 12 words");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();
    await completeSeedQuiz(page, seedPhrase);

    // Portfolio (no network needed for the heading itself).
    await page.getByRole("heading", { name: "Portfolio" }).waitFor({ timeout: 30000 });
    assert(true, "portfolio rendered after seed quiz");

    // Receive copy control is accessible (real client-side derivation).
    const copyBtn = page.getByRole("button", { name: "Copy ethereum receive address" });
    await copyBtn.waitFor({ state: "visible", timeout: 30000 });
    assert(await copyBtn.isVisible(), 'receive "Copy ethereum receive address" control is accessible');

    // Payment request (Phase 1): the Address/Request switch flips the receive
    // card to the EIP-681/BIP-21 builder. Network-independent — we assert the
    // panel MOUNTS (its empty-state or amount field), not a live-balance URI.
    await page.getByRole("button", { name: "Request", exact: true }).click();
    await copyBtn.waitFor({ state: "hidden", timeout: 10000 });
    const requestPanel = await firstVisible(
      [
        page.getByLabel("Amount (optional)"),
        page.getByText("No assets available for a payment request.", { exact: false }),
      ],
      30000,
    );
    assert(requestPanel, "payment-request (EIP-681/BIP-21) panel mounts under the Request tab");

    // Recovery Check — re-verify the passphrase without re-exposing the seed.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("heading", { name: "Recovery Check" }).waitFor({ timeout: 30000 });
    await page.getByLabel("Passphrase", { exact: true }).fill(PASS);
    await page.getByRole("button", { name: "Verify passphrase" }).click();
    await page.getByText("Passphrase verified.", { exact: false }).waitFor({ timeout: 30000 });
    assert(true, "Recovery Check verified the passphrase");
  } finally {
    await context.close();
  }
}

/**
 * Watch-only flow (Phase 5): a FRESH context (no wallet) so onboarding shows.
 * Watch an external EVM address and assert the read-only view disables signing.
 * Network-independent — the signing-disabled notice renders regardless of the
 * (public) balance read.
 */
async function watchOnlyFlow(browser, appUrl) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    // Onboarding present (Create is default) before switching to the Watch tab.
    await page.getByRole("button", { name: "Create wallet" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Watch", exact: true }).click();
    await page.getByLabel("Address to watch").fill(WATCH_ADDRESS);
    await page.getByRole("button", { name: "Start watching" }).click();
    await page.getByText("Watch-only wallets cannot sign", { exact: false }).waitFor({ timeout: 30000 });
    assert(true, "watch-only view shows the signing-disabled notice");
  } finally {
    await context.close();
  }
}

async function main() {
  // 1. Build the headless core, then the Next app. BTC stays unconfigured so
  //    the smoke does not depend on any network endpoint.
  console.log("[smoke] building wallet-core …");
  await waitForExit(run("corepack pnpm --filter @wdk-web/wallet-core build"), "wallet-core build");
  console.log("[smoke] building Next app …");
  await waitForExit(run("corepack pnpm exec next build", { cwd: NEXT_DIR }), "next build");

  // 2. Serve the production build on an OS-assigned free port.
  const port = await freePort();
  const appUrl = `http://127.0.0.1:${port}`;
  console.log(`[smoke] starting Next on ${appUrl} …`);
  const server = run(`corepack pnpm exec next start -p ${port}`, { cwd: NEXT_DIR });
  await waitForHttp(appUrl, 60000);

  // 3. Drive the real client through two independent flows, each in its own
  //    browser context so the second starts from a clean (wallet-less) slate.
  const browser = await chromium.launch();
  try {
    await walletFlow(browser, appUrl); // create → quiz → portfolio → receive → request → recovery
    await watchOnlyFlow(browser, appUrl); // Phase 5: external address, signing disabled
  } finally {
    await browser.close();
    killTree(server);
  }
}

main()
  .then(() => {
    console.log("[smoke] PASS");
    for (const c of children) killTree(c);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`[smoke] FAILED: ${err.message}`);
    for (const c of children) killTree(c);
    process.exit(1);
  });
