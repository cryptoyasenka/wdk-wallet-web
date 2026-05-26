/**
 * Unit tests for the Phase-3 address-book data layer. The focus is the audit
 * hardening: persisted JSON is untrusted, so a corrupt or pre-v2 blob must
 * degrade (drop bad rows) rather than throw, and the favorites-first ordering
 * must be stable. These helpers are pure (no localStorage), so they pin the
 * contract the Settings UI relies on.
 */
import { describe, expect, it } from "vitest";
import {
  sanitizeContacts,
  sanitizeTemplates,
  sortContacts,
  type Contact,
} from "../src/lib/contacts";

describe("sanitizeContacts", () => {
  it("keeps a valid v1 contact (name/address/chain only)", () => {
    const out = sanitizeContacts([{ name: "Alice", address: "0xabc", chain: "ethereum" }]);
    expect(out).toEqual([{ name: "Alice", address: "0xabc", chain: "ethereum" }]);
  });

  it("keeps well-typed v2 optional fields and drops malformed ones", () => {
    const out = sanitizeContacts([
      { name: "Bob", address: "0xdef", chain: "polygon", note: "rent", favorite: true, lastUsedAt: 5, createdAt: 1, bogus: "x" },
      { name: "Carol", address: "0x111", chain: "ethereum", favorite: "yes", lastUsedAt: "nope" },
    ]);
    expect(out[0]).toEqual({ name: "Bob", address: "0xdef", chain: "polygon", note: "rent", favorite: true, lastUsedAt: 5, createdAt: 1 });
    // Carol's mistyped favorite/lastUsedAt are dropped, but the row survives.
    expect(out[1]).toEqual({ name: "Carol", address: "0x111", chain: "ethereum" });
  });

  it("drops rows missing required fields and never throws on junk", () => {
    expect(sanitizeContacts([{ name: "", address: "0x1", chain: "eth" }, { address: "0x2" }, 42, null, "x"])).toEqual([]);
    expect(sanitizeContacts(null)).toEqual([]);
    expect(sanitizeContacts("corrupt")).toEqual([]);
    expect(sanitizeContacts({ not: "an array" })).toEqual([]);
  });
});

describe("sortContacts", () => {
  it("orders favorites first, then most-recently-used, then by name", () => {
    const contacts: Contact[] = [
      { name: "Zoe", address: "a", chain: "ethereum" },
      { name: "Amy", address: "b", chain: "ethereum", favorite: true, lastUsedAt: 10 },
      { name: "Max", address: "c", chain: "ethereum", lastUsedAt: 99 },
      { name: "Ben", address: "d", chain: "ethereum", favorite: true, lastUsedAt: 50 },
    ];
    expect(sortContacts(contacts).map((c) => c.name)).toEqual(["Ben", "Amy", "Max", "Zoe"]);
  });
});

describe("sanitizeTemplates", () => {
  it("keeps a valid template and backfills createdAt", () => {
    const out = sanitizeTemplates([{ id: "t1", name: "Rent", contactAddress: "0xabc", chain: "ethereum", assetKey: "USDT-ethereum", amount: "500" }]);
    expect(out[0]).toMatchObject({ id: "t1", name: "Rent", contactAddress: "0xabc", chain: "ethereum", assetKey: "USDT-ethereum", amount: "500" });
    expect(typeof out[0]!.createdAt).toBe("number");
  });

  it("drops templates missing required fields", () => {
    expect(sanitizeTemplates([{ id: "t1", name: "x" }, null, 7])).toEqual([]);
    expect(sanitizeTemplates("nope")).toEqual([]);
  });
});
