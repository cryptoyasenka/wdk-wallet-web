import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { translations, type Locale } from "../src/lib/i18n";

/**
 * Guards the headline feature of this template: a genuine three-language
 * (en/ru/uk) wallet. Two checks:
 *
 *  - COMPLETENESS — every key carries a non-empty string in all three locales,
 *    so the UI can never silently fall back to English (or to the key itself).
 *  - USAGE — every literal `T("…")` / `t("…")` key referenced by the Next app
 *    source actually exists in the table, so a renamed/typo'd key is caught.
 *
 * Both run under vitest's node environment (no DOM): the first reads the
 * imported table directly; the second reads the source as text. The usage scan
 * is deliberately conservative — it only inspects string-literal keys, so
 * dynamic lookups (e.g. T(`fee.${p}`) or T(label)) are skipped rather than
 * mis-flagged.
 */

const LOCALES: readonly Locale[] = ["en", "ru", "uk"];

describe("i18n translation table", () => {
  it("has at least one key", () => {
    expect(Object.keys(translations).length).toBeGreaterThan(0);
  });

  it("defines a non-empty en, ru and uk string for every key", () => {
    const missing: string[] = [];
    for (const [key, entry] of Object.entries(translations)) {
      for (const locale of LOCALES) {
        const value = entry[locale];
        if (typeof value !== "string" || value.trim() === "") {
          missing.push(`${key} → ${locale}`);
        }
      }
    }
    expect(missing, `incomplete translations:\n${missing.join("\n")}`).toEqual([]);
  });
});

/** Source files that look up translations by literal key. */
const SOURCE_FILES = ["../app/page.tsx"] as const;

/** Collect every distinct string-literal key passed to T("…") or t("…"). */
function usedLiteralKeys(source: string): Set<string> {
  const keys = new Set<string>();
  // \b[tT]\( then a double-quoted string. Dynamic args (templates, identifiers)
  // do not match and are intentionally ignored.
  const re = /\b[tT]\(\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const key = m[1];
    if (key) keys.add(key);
  }
  return keys;
}

describe("i18n used keys", () => {
  it("every literal T(\"…\") key referenced in the Next source exists in the table", () => {
    const undefinedKeys: string[] = [];
    for (const rel of SOURCE_FILES) {
      const path = fileURLToPath(new URL(rel, import.meta.url));
      const source = readFileSync(path, "utf8");
      for (const key of usedLiteralKeys(source)) {
        if (!(key in translations)) undefinedKeys.push(`${key} (in ${rel})`);
      }
    }
    expect(undefinedKeys, `keys used but not defined:\n${undefinedKeys.join("\n")}`).toEqual([]);
  });

  it("finds a meaningful number of used keys (guards the scanner regex)", () => {
    const source = readFileSync(fileURLToPath(new URL("../app/page.tsx", import.meta.url)), "utf8");
    // Sanity floor: if the regex silently broke, this would drop to ~0.
    expect(usedLiteralKeys(source).size).toBeGreaterThan(50);
  });
});
