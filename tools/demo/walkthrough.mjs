// Product-walkthrough recorder — produces docs/walkthrough.mp4.
//
// `node tools/demo/walkthrough.mjs` runs this. Like record.mjs / smoke.mjs it is
// demo tooling, NOT the wallet: it lives outside the pnpm workspace, never
// imports @tetherto/* or @wdk-web/wallet-core, and is untouched by the lint /
// typecheck / test / build quartet. It builds the REAL production Next app and
// drives the REAL client-side wallet in Chromium. Only the BTC Electrum reads
// come from the local offline fixture (tools/demo/electrum-ws-fixture.mjs) so the
// BTC row is deterministic without a public endpoint or a secret. EVM/SOL
// balances are the real (zero, for a fresh wallet) values from the public
// failover RPCs wallet-core ships with. Nothing in the UI layer is mocked.
//
// It records two segments in two browser contexts and concatenates them:
//   A. the wallet story: create -> back up seed -> seed quiz -> portfolio
//      (BTC fixture + ETH/USD₮/XAU₮/SOL real) -> receive address + QR ->
//      payment request (EIP-681/BIP-21) -> Send form + pre-send Safety Panel
//      (attempted; see below) -> Settings - Recovery Check.
//   B. watch-only: a fresh wallet-less context watches an external address and
//      the read-only view disables signing. Ends on the outro caption.
//
// HONEST LIMITS — it STOPS before any broadcast. The Safety Panel sits behind a
// successful fee quote (engine.quoteSend); a fresh wallet has no funds, so the
// quote may legitimately fail. The recorder ATTEMPTS the panel and captures it
// if it renders, otherwise it logs that the panel needs funds and moves on — the
// funded end-to-end send (with the panel + a real tx id) is the manual Video B.
// The "Confirm & send" button is NEVER clicked.
//
// Captions are burned in as an on-screen banner (English). The UI is pinned to
// en-US so the English role/text selectors below are deterministic.
//
// Prereqs (one-time):
//   corepack pnpm exec playwright install chromium
//   ffmpeg on PATH   # webm -> mp4

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", ".."); // repo root (tools/demo -> repo)
const NEXT_DIR = join(ROOT, "apps", "next");
const OUT = join(ROOT, "docs", "walkthrough.mp4");
const FRAMES = join(ROOT, "tools", "demo", "frames");
const LOCALE = process.env.LOCALE || "en-US";
const APP_PORT = Number(process.env.DEMO_APP_PORT ?? 4318);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const VIEWPORT = { width: 430, height: 1180 };
const PASS = "demo-passphrase-2026";
// Well-known mainnet address (Ethereum Foundation): valid EVM shape, so it is an
// honest "new recipient" for the Safety Panel and watch-only. No funds move.
const SAMPLE_RECIPIENT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const IS_WIN = process.platform === "win32";
/** Spawned children we must reap even if a step throws. */
const children = [];

function run(cmd, { cwd = ROOT, env = process.env, capture = false } = {}) {
  // shell:true so `corepack` resolves on Windows (corepack.cmd) and POSIX.
  const child = spawn(cmd, { cwd, env, shell: true, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
  children.push(child);
  return child;
}

/** Kill a child and, on Windows, its whole process tree (corepack->pnpm->node). */
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

/** Start the offline Electrum-WS fixture; resolve its ephemeral port. */
async function startFixture() {
  const child = run(`node ${JSON.stringify(join("tools", "demo", "electrum-ws-fixture.mjs"))}`, { capture: true });
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

/** Resolve true as soon as any locator becomes visible, else false. */
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

/** Encode a Playwright .webm to a faststart H.264 mp4 (judge/browser friendly). */
async function encodeMp4(webm, out) {
  await ffmpeg(
    ["-y", "-i", webm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "30", "-crf", "22", "-preset", "medium", "-an", out],
    "ffmpeg mp4",
  );
}

/** Per-page helpers: a burned-in caption banner, paced beats, QA screenshots. */
function makeHelpers(page, segment) {
  const setCaption = (text) =>
    page.evaluate((t) => {
      let d = document.getElementById("demo-cap");
      if (!d) {
        d = document.createElement("div");
        d.id = "demo-cap";
        d.style.cssText =
          "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:14px 18px 18px;" +
          "font:600 15px/1.35 system-ui,'Segoe UI',Roboto,sans-serif;color:#d1fae5;" +
          "background:linear-gradient(0deg,rgba(3,10,20,.97),rgba(3,10,20,.80));" +
          "border-top:2px solid #10b981;text-align:center;letter-spacing:.2px";
        document.body.appendChild(d);
      }
      d.textContent = t;
    }, text);
  const beat = (ms = 1100) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: join(FRAMES, `${segment}-${name}.png`) });
  return { setCaption, beat, shot };
}

/** Record one segment in its own context; always finalises the .webm. */
async function recordSegment(browser, label, fn) {
  const dir = mkdtempSync(join(tmpdir(), `wdk-wt-${label}-`));
  const context = await browser.newContext({ viewport: VIEWPORT, locale: LOCALE, recordVideo: { dir, size: VIEWPORT } });
  const page = await context.newPage();
  let err = null;
  try {
    await fn(page, makeHelpers(page, label));
  } catch (e) {
    err = e;
    console.error(`[walkthrough] segment ${label} FAILED: ${e.message}`);
  }
  const video = page.video();
  await context.close(); // finalises the .webm
  const webm = video ? await video.path() : null;
  return { webm, dir, err };
}

// ---- Segment A: the wallet story --------------------------------------------
async function walletStory(page, { setCaption, beat, shot }) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  // A1 — onboarding (Create is the default tab).
  await page.getByRole("button", { name: "Create wallet" }).waitFor({ timeout: 30000 });
  await setCaption("Self-custodial WDK wallet — your keys never leave this device");
  await beat(1400);
  await page.getByLabel("Passphrase (encrypts the vault on this device)").fill(PASS);
  await page.getByLabel("Confirm passphrase").fill(PASS);
  await beat();
  await page.getByRole("button", { name: "Create wallet" }).click();

  // A2 — back up the seed (shown once).
  await page.getByRole("heading", { name: "Back up your seed phrase" }).waitFor({ timeout: 30000 });
  const seedPhrase = (await page.locator("pre").first().innerText()).trim();
  await setCaption("Recovery phrase shown once, stored only on this device");
  await beat(2400);
  await shot("A2-seed");
  await page.getByRole("checkbox").check();
  await beat();
  await page.getByRole("button", { name: "Continue" }).click();

  // A3 — seed quiz.
  await setCaption("Verify the backup before continuing");
  await completeSeedQuiz(page, seedPhrase);

  // A4 — portfolio (BTC from fixture; ETH/USD₮/XAU₮/SOL real, zero on a fresh wallet).
  await page.getByRole("heading", { name: "Portfolio" }).waitFor({ timeout: 30000 });
  await waitForBtcRow(page);
  await setCaption("Multi-chain: Bitcoin · USD₮ · XAU₮ across EVM + Solana");
  await beat(2600);
  await shot("A4-portfolio");

  // A5 — receive address + QR (real client-side key derivation, no server).
  await page.getByRole("heading", { name: "Receive" }).scrollIntoViewIfNeeded();
  await setCaption("Receive addresses derived client-side — with QR, no server");
  await beat(2400);
  await shot("A5-receive");

  // A6 — payment request (Phase 1, EIP-681 / BIP-21). The Address/Request switch
  // flips the receive card to the request builder; "0.00" is the request amount.
  await page.getByRole("button", { name: "Request", exact: true }).click();
  await page.getByPlaceholder("0.00", { exact: true }).fill("25");
  await setCaption("Payment requests — EIP-681 / BIP-21, with amount + memo");
  await beat(2400);
  await shot("A6-request");

  // A7 — Send form + pre-send Safety Panel. Attempted honestly: the panel sits
  // behind a successful fee quote, which a zero-balance wallet may refuse.
  await page.getByRole("heading", { name: "Send", exact: true }).scrollIntoViewIfNeeded();
  await setCaption("Pre-send safety — poisoning & look-alike checks before you sign");
  await beat(1200);
  // Pick a native EVM asset (best chance of a fund-free fee quote): find the
  // combobox whose options name chains/symbols (not the account selector).
  const combos = page.getByRole("combobox");
  const comboCount = await combos.count();
  let assetSelect = null;
  for (let i = 0; i < comboCount; i++) {
    const opts = await combos.nth(i).locator("option").allTextContents();
    if (opts.some((o) => /\bon\b/.test(o) || /\b(ETH|BTC|USD|SOL|XAU)/.test(o))) {
      assetSelect = combos.nth(i);
      const eth = opts.find((o) => /^ETH\b/.test(o)) || opts.find((o) => /ETH/.test(o)) || opts[0];
      await assetSelect.selectOption({ label: eth }).catch(() => {});
      break;
    }
  }
  await page.getByPlaceholder("destination address", { exact: true }).fill(SAMPLE_RECIPIENT);
  await page.getByPlaceholder("0.0", { exact: true }).fill("0.001");
  await beat(900);
  await page.getByRole("button", { name: "Review transaction" }).click();
  const safetyShown = await firstVisible([page.getByText("Before you send", { exact: false })], 9000);
  if (safetyShown) {
    await beat(900);
    await page.getByText("Before you send", { exact: false }).scrollIntoViewIfNeeded();
    await setCaption("Safety panel reached — stopping here, before any broadcast");
    await beat(3200);
    await shot("A7-safety");
    // Leave WITHOUT broadcasting. Never click "Confirm & send".
    await page.getByRole("button", { name: "Cancel" }).click().catch(() => {});
  } else {
    console.log("[walkthrough] A7: Safety Panel needs a funded quote — deferred to manual Video B.");
    await setCaption("Pre-send safety checks run before signing (funded send: Video B)");
    await beat(1800);
    await shot("A7-sendform");
  }

  // A9 — Recovery Check (re-verify the passphrase without re-exposing the seed).
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Recovery Check" }).waitFor({ timeout: 30000 });
  await page.getByLabel("Passphrase", { exact: true }).fill(PASS);
  await setCaption("Recovery Check re-verifies your passphrase — no seed re-exposure");
  await beat(900);
  await page.getByRole("button", { name: "Verify passphrase" }).click();
  await page.getByText("Passphrase verified.", { exact: false }).waitFor({ timeout: 30000 });
  await beat(1600);
  await shot("A9-recovery");
}

// ---- Segment B: watch-only + outro ------------------------------------------
async function watchOnly(page, { setCaption, beat, shot }) {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Create wallet" }).waitFor({ timeout: 30000 });

  // A8 — watch any address read-only (Phase 5); signing stays disabled.
  await setCaption("Watch any address read-only — signing stays disabled");
  await beat(1000);
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await page.getByLabel("Address to watch").fill(SAMPLE_RECIPIENT);
  await beat();
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.getByText("Watch-only wallets cannot sign", { exact: false }).waitFor({ timeout: 30000 });
  await beat(2400);
  await shot("A8-watch");

  // A10 — outro.
  await setCaption("github.com/cryptoyasenka/wdk-wallet-web · live demo");
  await beat(3600);
  await shot("A10-outro");
}

async function main() {
  mkdirSync(FRAMES, { recursive: true });

  // 1. Offline BTC fixture first — its port is baked into the Next build
  //    (NEXT_PUBLIC_* is inlined at build time, not read at runtime).
  const { child: fixture, port: fixturePort } = await startFixture();
  const env = { ...process.env, NEXT_PUBLIC_BTC_ELECTRUM_WS_URL: `ws://127.0.0.1:${fixturePort}` };
  console.log(`[walkthrough] Electrum-WS fixture on 127.0.0.1:${fixturePort}`);

  // 2. Build the headless core, then the Next app with the fixture URL inlined.
  console.log("[walkthrough] building wallet-core …");
  await waitForExit(run("corepack pnpm --filter @wdk-web/wallet-core build"), "wallet-core build");
  console.log("[walkthrough] building Next app …");
  await waitForExit(run("corepack pnpm exec next build", { cwd: NEXT_DIR, env }), "next build");

  // 3. Serve the production build.
  console.log(`[walkthrough] starting Next on ${APP_URL} …`);
  const server = run(`corepack pnpm exec next start -p ${APP_PORT}`, { cwd: NEXT_DIR, env });
  await waitForHttp(APP_URL, 60000);

  // 4. Record both segments.
  const browser = await chromium.launch();
  let segA, segB;
  try {
    console.log("[walkthrough] recording segment A (wallet story) …");
    segA = await recordSegment(browser, "A", walletStory);
    console.log("[walkthrough] recording segment B (watch-only + outro) …");
    segB = await recordSegment(browser, "B", watchOnly);
  } finally {
    await browser.close();
    killTree(server);
    killTree(fixture);
  }

  // 5. Encode + concatenate into docs/walkthrough.mp4.
  if (!segA?.webm) throw new Error("segment A produced no video");
  const workDir = mkdtempSync(join(tmpdir(), "wdk-wt-enc-"));
  try {
    const mp4A = join(workDir, "a.mp4");
    console.log("[walkthrough] encoding segment A …");
    await encodeMp4(segA.webm, mp4A);

    if (segB?.webm) {
      const mp4B = join(workDir, "b.mp4");
      console.log("[walkthrough] encoding segment B …");
      await encodeMp4(segB.webm, mp4B);
      const list = join(workDir, "concat.txt");
      writeFileSync(list, `file '${mp4A.replace(/\\/g, "/")}'\nfile '${mp4B.replace(/\\/g, "/")}'\n`);
      console.log("[walkthrough] concatenating …");
      await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", OUT], "ffmpeg concat");
    } else {
      console.log("[walkthrough] segment B missing — writing segment A only.");
      await ffmpeg(["-y", "-i", mp4A, "-c", "copy", OUT], "ffmpeg copy");
    }
    console.log(`[walkthrough] wrote ${OUT}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
    if (segA?.dir) rmSync(segA.dir, { recursive: true, force: true });
    if (segB?.dir) rmSync(segB.dir, { recursive: true, force: true });
  }

  if (!existsSync(OUT)) throw new Error("ffmpeg did not produce docs/walkthrough.mp4");
  if (segA?.err) console.warn(`[walkthrough] note: segment A had a non-fatal error: ${segA.err.message}`);
  if (segB?.err) console.warn(`[walkthrough] note: segment B had a non-fatal error: ${segB.err.message}`);
}

main()
  .then(() => {
    for (const c of children) killTree(c);
    process.exit(0);
  })
  .catch((err) => {
    console.error(`[walkthrough] FAILED: ${err.message}`);
    for (const c of children) killTree(c);
    process.exit(1);
  });
