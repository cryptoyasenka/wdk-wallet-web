// Accessibility audit — `pnpm a11y`.
//
// Sibling of smoke.mjs: same "build the real prod app, serve it, drive a real
// browser" machinery, but instead of asserting flows it runs axe-core (the
// industry-standard WCAG engine) against every key screen and reports the
// violations. Like the smoke test it is TOOLING, not the wallet: it lives
// outside the pnpm workspace, never imports @tetherto/* or @wdk-web/wallet-core,
// and is untouched by the lint / typecheck / test / build quartet.
//
// CSP note: the app ships a strict per-request nonce CSP (script-src 'self'
// 'nonce-…' 'strict-dynamic'), which would block injecting axe's source into
// the page. We open the audit context with `bypassCSP: true` SO THAT THE AUDIT
// CAN RUN — this relaxation is local to the audit browser, never to the app.
// The CSP itself is proven separately by smoke.mjs under the real header.
//
// Exit code: 1 if any violation at or above the threshold impact (default
// "serious"; override with A11Y_FAIL_ON=minor|moderate|serious|critical) is
// found on any audited screen, else 0. Run discovery with A11Y_FAIL_ON=none.
//
// Prereq (one-time): corepack pnpm exec playwright install chromium

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const axeSource = require("axe-core").source;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const NEXT_DIR = join(ROOT, "apps", "next");
const IS_WIN = process.platform === "win32";
const children = [];

// WCAG 2.0/2.1 levels A + AA — the tags a reviewer expects a wallet to clear.
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const IMPACT_RANK = { minor: 1, moderate: 2, serious: 3, critical: 4 };
const FAIL_ON = (process.env.A11Y_FAIL_ON ?? "serious").toLowerCase();
const FAIL_RANK = FAIL_ON === "none" ? Infinity : (IMPACT_RANK[FAIL_ON] ?? 3);

const VIEWPORT = { width: 430, height: 1180 };
const PASS = "a11y-passphrase-2026";
const WATCH_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

function run(cmd, { cwd = ROOT, env = process.env } = {}) {
  const child = spawn(cmd, { cwd, env, shell: true, stdio: "inherit" });
  children.push(child);
  return child;
}
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

/** Inject axe and audit the current DOM. Returns axe's violations array. */
async function audit(page, label, results) {
  await page.evaluate(axeSource);
  const { violations } = await page.evaluate(
    async (tags) => await window.axe.run(document, { runOnly: tags }),
    AXE_TAGS,
  );
  const worst = violations.reduce((m, v) => Math.max(m, IMPACT_RANK[v.impact] ?? 0), 0);
  console.log(
    `[a11y] ${label}: ${violations.length} violation type(s)` +
      (violations.length ? ` (worst: ${Object.keys(IMPACT_RANK).find((k) => IMPACT_RANK[k] === worst) ?? "?"})` : ""),
  );
  for (const v of violations) {
    console.log(`   - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`);
    for (const n of v.nodes.slice(0, 4)) {
      console.log(`       ↳ ${n.target.join(" ")}`);
      if (n.failureSummary) console.log(`         ${n.failureSummary.replace(/\n/g, "\n         ")}`);
    }
    console.log(`       ${v.helpUrl}`);
  }
  results.push({ label, violations });
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

/** Walk the full wallet UI, auditing each screen. */
async function auditWallet(browser, appUrl, results) {
  const context = await browser.newContext({ viewport: VIEWPORT, bypassCSP: true });
  const page = await context.newPage();
  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Create wallet" }).waitFor({ timeout: 30000 });
    await audit(page, "onboarding · Create", results);

    await page.getByRole("button", { name: "Watch", exact: true }).click();
    await page.getByLabel("Address to watch").waitFor({ timeout: 10000 });
    await audit(page, "onboarding · Watch", results);

    // Back to Create and make a wallet so we can reach the inner screens.
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByLabel("Passphrase (encrypts the vault on this device)").fill(PASS);
    await page.getByLabel("Confirm passphrase").fill(PASS);
    await page.getByRole("button", { name: "Create wallet" }).click();

    await page.getByRole("heading", { name: "Back up your seed phrase" }).waitFor({ timeout: 30000 });
    await audit(page, "backup seed phrase", results);
    const seedPhrase = (await page.locator("pre").first().innerText()).trim();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByRole("heading", { name: "Verify your seed phrase" }).waitFor({ timeout: 30000 });
    await audit(page, "seed quiz", results);
    await completeSeedQuiz(page, seedPhrase);

    await page.getByRole("heading", { name: "Portfolio" }).waitFor({ timeout: 30000 });
    await audit(page, "portfolio", results);

    // Receive — Address card, then the payment-request (Request) panel.
    await page.getByRole("button", { name: "Copy ethereum receive address" }).waitFor({ timeout: 30000 });
    await audit(page, "receive · Address", results);
    await page.getByRole("button", { name: "Request", exact: true }).click();
    await page.getByLabel("Amount (optional)").waitFor({ timeout: 30000 }).catch(() => {});
    await audit(page, "receive · Request (payment URI)", results);

    // Settings (Recovery Check, Data Sources, Address Book, privacy toggles).
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("heading", { name: "Recovery Check" }).waitFor({ timeout: 30000 });
    await audit(page, "settings", results);
  } finally {
    await context.close();
  }
}

async function main() {
  console.log("[a11y] building wallet-core …");
  await waitForExit(run("corepack pnpm --filter @wdk-web/wallet-core build"), "wallet-core build");
  console.log("[a11y] building Next app …");
  await waitForExit(run("corepack pnpm exec next build", { cwd: NEXT_DIR }), "next build");

  const port = await freePort();
  const appUrl = `http://127.0.0.1:${port}`;
  console.log(`[a11y] starting Next on ${appUrl} …`);
  const server = run(`corepack pnpm exec next start -p ${port}`, { cwd: NEXT_DIR });
  await waitForHttp(appUrl, 60000);

  const results = [];
  const browser = await chromium.launch();
  try {
    await auditWallet(browser, appUrl, results);
  } finally {
    await browser.close();
    killTree(server);
  }

  // Summary + threshold gate. Dedupe violation ids across screens for the count.
  const all = results.flatMap((r) => r.violations);
  const offending = all.filter((v) => (IMPACT_RANK[v.impact] ?? 0) >= FAIL_RANK);
  const ids = [...new Set(all.map((v) => `${v.impact}:${v.id}`))].sort();
  console.log(`\n[a11y] ${ids.length} distinct violation type(s) across ${results.length} screen(s):`);
  for (const id of ids) console.log(`   • ${id}`);
  if (offending.length) {
    console.log(`\n[a11y] FAIL — ${offending.length} violation instance(s) at impact >= ${FAIL_ON}.`);
    return 1;
  }
  console.log(`\n[a11y] PASS — no violations at impact >= ${FAIL_ON}.`);
  return 0;
}

main()
  .then((code) => {
    for (const c of children) killTree(c);
    process.exit(code);
  })
  .catch((err) => {
    console.error(`[a11y] ERROR: ${err.message}`);
    for (const c of children) killTree(c);
    process.exit(2);
  });
