// Reproducible end-to-end demo recorder — produces docs/demo.gif.
//
// `pnpm demo` runs this. It is demo tooling, not the wallet: it lives outside
// the pnpm workspace, never imports @tetherto/* or @wdk-web/wallet-core, and is
// not touched by the lint / typecheck / test / build quartet. It drives the
// REAL built Next app against a REAL client-side wallet — only the BTC Electrum
// reads are served by the local offline fixture (tools/demo/electrum-ws-fixture
// .mjs) so the BTC row is deterministic without a public endpoint or a secret.
// EVM balances are the real (zero, for a fresh wallet) values from the public
// failover RPC list wallet-core ships with. Nothing is mocked in the UI layer.
//
// Flow recorded: create wallet → reveal + back up seed → unlock → portfolio
// (BTC populated from the fixture, ETH/USD₮/XAUT real) → receive (real
// client-derived BTC + EVM addresses). It deliberately STOPS before send:
// signing/broadcast is real in the app, but the offline fixture does not
// fabricate spendable UTXOs or a chain transaction.
//
// Prereqs (documented in README next to the demo image):
//   corepack pnpm exec playwright install chromium   # one-time
//   ffmpeg on PATH                                    # webm → gif

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", ".."); // repo root (tools/demo → repo)
const NEXT_DIR = join(ROOT, "apps", "next");
const GIF_OUT = join(ROOT, "docs", "demo.gif");
const APP_PORT = Number(process.env.DEMO_APP_PORT ?? 4317);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;

const IS_WIN = process.platform === "win32";
/** Spawned children we must reap even if a step throws. */
const children = [];

function run(cmd, { cwd = ROOT, env = process.env, capture = false } = {}) {
  // shell:true so `corepack` resolves on Windows (corepack.cmd) and POSIX.
  const child = spawn(cmd, { cwd, env, shell: true, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
  children.push(child);
  return child;
}

/** Kill a child and, on Windows, its whole process tree (corepack→pnpm→node). */
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    // Synchronous on purpose: process.exit() must not race the kill. An async
    // spawn here gets torn down before taskkill reaps the tree, which orphans
    // `next start` (it keeps holding the port). spawnSync blocks until done.
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

/** Start the offline Electrum-WS fixture; resolve its ephemeral port. */
async function startFixture() {
  const child = run(`node ${JSON.stringify(join("tools", "demo", "electrum-ws-fixture.mjs"))}`, {
    capture: true,
  });
  let buf = "";
  for await (const chunk of child.stdout) {
    buf += chunk.toString();
    const m = buf.match(/FIXTURE_PORT=(\d+)/);
    if (m) return { child, port: Number(m[1]) };
  }
  throw new Error("Electrum-WS fixture exited before announcing a port");
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

/** Click "Retry" if the portfolio surfaced a balances error (flaky public RPC). */
async function waitForBtcRow(page) {
  const btcRow = page.getByRole("listitem").filter({ hasText: "BTC" }).first();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await btcRow.waitFor({ state: "visible", timeout: 30000 });
      return;
    } catch {
      const retry = page.getByRole("button", { name: "Retry" });
      if (await retry.isVisible().catch(() => false)) {
        await retry.click();
        continue;
      }
      throw new Error("Portfolio never showed the BTC row and offered no Retry");
    }
  }
  throw new Error("Portfolio BTC row did not appear after retries");
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

async function ffmpeg(args, label) {
  const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(child);
  await waitForExit(child, label);
}

async function main() {
  // 1. Offline BTC fixture first — its port is baked into the Next build,
  //    because NEXT_PUBLIC_* is inlined at build time, not read at runtime.
  const { child: fixture, port: fixturePort } = await startFixture();
  const env = {
    ...process.env,
    NEXT_PUBLIC_BTC_ELECTRUM_WS_URL: `ws://127.0.0.1:${fixturePort}`,
  };
  console.log(`[demo] Electrum-WS fixture on 127.0.0.1:${fixturePort}`);

  // 2. Build the headless core, then the Next app with the fixture URL inlined.
  console.log("[demo] building wallet-core …");
  await waitForExit(run("corepack pnpm --filter @wdk-web/wallet-core build"), "wallet-core build");
  console.log("[demo] building Next app …");
  await waitForExit(run("corepack pnpm exec next build", { cwd: NEXT_DIR, env }), "next build");

  // 3. Serve the production build.
  console.log(`[demo] starting Next on ${APP_URL} …`);
  const server = run(`corepack pnpm exec next start -p ${APP_PORT}`, { cwd: NEXT_DIR, env });
  await waitForHttp(APP_URL, 60000);

  // 4. Record the walkthrough. A tall, narrow viewport frames the single-column
  //    max-w-md wallet like a phone. Pauses are deliberate — this is a recorder,
  //    not a test; the pacing is what makes the GIF readable.
  const videoDir = mkdtempSync(join(tmpdir(), "wdk-demo-"));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 430, height: 1180 },
    recordVideo: { dir: videoDir, size: { width: 430, height: 1180 } },
  });
  const page = await context.newPage();
  const beat = (ms = 1100) => page.waitForTimeout(ms);

  try {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

    // Onboarding (Create is the default tab).
    await page.getByRole("button", { name: "Create wallet" }).waitFor({ timeout: 30000 });
    await beat();
    await page.getByLabel("Passphrase (encrypts the vault on this device)").fill("demo-passphrase-2026");
    await page.getByLabel("Confirm passphrase").fill("demo-passphrase-2026");
    await beat();
    await page.getByRole("button", { name: "Create wallet" }).click();

    // Back up the seed (shown once) — pause so the GIF reads it.
    await page.getByRole("heading", { name: "Back up your seed phrase" }).waitFor({ timeout: 30000 });
    const seedPhrase = (await page.locator("pre").first().innerText()).trim();
    await beat(2200);
    await page.getByRole("checkbox").check();
    await beat();
    await page.getByRole("button", { name: "Continue" }).click();
    await completeSeedQuiz(page, seedPhrase);

    // Portfolio — BTC from the fixture, ETH/USD₮/XAUT real (zero, fresh wallet).
    await page.getByRole("heading", { name: "Portfolio" }).waitFor({ timeout: 30000 });
    await waitForBtcRow(page);
    await beat(2600);

    // Receive — the BTC and ETH addresses are real client-side key derivation
    // (pure key math, no socket). This is the honest end of the demo: it shows
    // what genuinely works with no endpoint configured — BTC + USD₮ live on the
    // web, client-side. Sending is real in the app, but a real BTC send needs
    // spendable UTXOs from a live Electrum endpoint; the offline fixture
    // deliberately does NOT fabricate a signed transaction (honest limits, see
    // docs/SECURITY.md). The portfolio + real derived addresses are the proof.
    await page.getByRole("heading", { name: "Receive" }).scrollIntoViewIfNeeded();
    await beat(3800); // hold on the proof frame (BTC + USD₮, real addresses)
  } finally {
    const video = page.video();
    await context.close(); // finalises the .webm
    await browser.close();

    if (video) {
      const webm = await video.path();
      console.log("[demo] encoding gif …");
      const pal = join(videoDir, "palette.png");
      // 10 fps / 420px keeps a README-friendly gif (a few MB, not tens).
      const vf = "fps=10,scale=420:-1:flags=lanczos";
      await ffmpeg(
        ["-y", "-i", webm, "-vf", `${vf},palettegen=stats_mode=diff`, "-update", "1", pal],
        "ffmpeg palettegen",
      );
      await ffmpeg(
        ["-y", "-i", webm, "-i", pal, "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, GIF_OUT],
        "ffmpeg gif",
      );
      console.log(`[demo] wrote ${GIF_OUT}`);
    }
    killTree(server);
    rmSync(videoDir, { recursive: true, force: true });
  }

  killTree(fixture);
  if (!existsSync(GIF_OUT)) throw new Error("ffmpeg did not produce docs/demo.gif");
}

main()
  .then(() => {
    for (const c of children) killTree(c);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`[demo] FAILED: ${err.message}`);
    for (const c of children) killTree(c);
    process.exit(1);
  });
