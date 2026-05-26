// Permanent end-to-end smoke test — `pnpm smoke`.
//
// This is the manual reviewer walkthrough, automated and repeatable. Like the
// demo recorder it is tooling, NOT the wallet: it lives outside the pnpm
// workspace, never imports @tetherto/* or @wdk-web/wallet-core, and is not
// touched by the lint / typecheck / test / build quartet. It builds the real
// headless core + the real production Next app and drives the real client-side
// wallet through a browser.
//
// Flow asserted (exit 1 on any failure):
//   1. create wallet with a passphrase;
//   2. back up the seed phrase + pass the seed quiz;
//   3. land on the portfolio;
//   4. the receive card exposes an accessible "Copy … receive address" control
//      (real client-side key derivation — no network needed);
//   5. Recovery Check re-verifies the passphrase without re-exposing the seed.
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

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 430, height: 1180 } });
  const page = await context.newPage();
  const PASS = "smoke-passphrase-2026";

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

    // 3. Portfolio (no network needed for the heading itself).
    await page.getByRole("heading", { name: "Portfolio" }).waitFor({ timeout: 30000 });
    assert(true, "portfolio rendered after seed quiz");

    // 4. Receive copy control is accessible (real client-side derivation).
    const copyBtn = page.getByRole("button", { name: "Copy ethereum receive address" });
    await copyBtn.waitFor({ state: "visible", timeout: 30000 });
    assert(await copyBtn.isVisible(), 'receive "Copy ethereum receive address" control is accessible');

    // 5. Recovery Check — re-verify the passphrase without re-exposing the seed.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("heading", { name: "Recovery Check" }).waitFor({ timeout: 30000 });
    await page.getByLabel("Passphrase", { exact: true }).fill(PASS);
    await page.getByRole("button", { name: "Verify passphrase" }).click();
    await page.getByText("Passphrase verified.", { exact: false }).waitFor({ timeout: 30000 });
    assert(true, "Recovery Check verified the passphrase");
  } finally {
    await context.close();
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
