// Render the GitHub social-preview (og:image) from card.html → PNG, 1280×640.
//
// Tooling only: lives outside the pnpm workspace, never imports @tetherto/* or
// @wdk-web/wallet-core (same rule as tools/e2e/smoke.mjs). Pure local render —
// no network. Uses the repo's own @playwright/test chromium.
//
//   node tools/social-preview/render.mjs              # default "emerald"
//   node tools/social-preview/render.mjs emerald glass # render both variants
//
// The FIRST variant given is written to .github/social-preview.png (the real
// og:image); any further variants go to .github/social-preview-<v>.png for
// side-by-side comparison before picking one.

import { chromium } from "@playwright/test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cardPath = join(__dirname, "card.html");
const outDir = resolve(__dirname, "..", "..", ".github");
const W = 1280, H = 640;

const variants = process.argv.slice(2);
const todo = variants.length ? variants : ["emerald"];

const browser = await chromium.launch();
try {
  for (let i = 0; i < todo.length; i++) {
    const v = todo[i];
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const url = pathToFileURL(cardPath).href + "?v=" + encodeURIComponent(v);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(120); // let gradients/shadows settle
    const out = i === 0
      ? join(outDir, "social-preview.png")
      : join(outDir, `social-preview-${v}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
    console.log("wrote", out);
    await page.close();
  }
} finally {
  await browser.close();
}
