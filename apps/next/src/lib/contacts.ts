/**
 * Address book (saved contacts) + payment templates, persisted in localStorage.
 *
 * v2 (Phase 3) extends a contact beyond name/address/chain with an optional
 * note, favorite flag, and last-used / created timestamps so the book becomes
 * repeat-payment infrastructure, and adds reusable payment templates. Old v1
 * contacts (name/address/chain only) load unchanged.
 *
 * Hardening (2026-05-26 audit): persisted JSON is untrusted input — a corrupt
 * or pre-v2 blob must never throw or poison the UI. Every record is shape-
 * validated on load and malformed rows are dropped, instead of a bare
 * `JSON.parse` cast.
 */

import { normalizeAddress } from "./address";

export interface Contact {
  name: string;
  address: string;
  chain: string;
  // `string | undefined` (not just optional) so an edit can explicitly clear a
  // note via updateContact under exactOptionalPropertyTypes.
  note?: string | undefined;
  favorite?: boolean;
  lastUsedAt?: number;
  createdAt?: number;
}

export interface PaymentTemplate {
  id: string;
  name: string;
  contactAddress: string;
  chain: string;
  assetKey: string;
  amount?: string;
  memo?: string;
  createdAt: number;
}

const CONTACTS_KEY = "wdk-contacts";
const TEMPLATES_KEY = "wdk-templates";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Address identity for matching the same payee. EVM addresses are
 * case-insensitive; BTC and Solana addresses are not — `normalizeAddress` is
 * the shared rule, so the address book stays in sync with recipient
 * classification in safety.ts. Without this, a send to `0xabc…` would not stamp
 * a contact saved as `0xABC…`, silently breaking the last-used / recent-sort
 * feature.
 */
function sameAddress(a: string, b: string, chain: string): boolean {
  return normalizeAddress(a, chain) === normalizeAddress(b, chain);
}

/**
 * Validate + coerce one untrusted record into a Contact, or null if it lacks
 * the required name/address/chain strings. Optional fields are kept only when
 * well-typed, so a partially-corrupt row degrades instead of breaking.
 */
function toContact(v: unknown): Contact | null {
  if (!isRecord(v)) return null;
  if (!nonEmptyString(v.name) || !nonEmptyString(v.address) || !nonEmptyString(v.chain)) return null;
  const c: Contact = { name: v.name, address: v.address, chain: v.chain };
  if (typeof v.note === "string") c.note = v.note;
  if (typeof v.favorite === "boolean") c.favorite = v.favorite;
  if (typeof v.lastUsedAt === "number" && Number.isFinite(v.lastUsedAt)) c.lastUsedAt = v.lastUsedAt;
  if (typeof v.createdAt === "number" && Number.isFinite(v.createdAt)) c.createdAt = v.createdAt;
  return c;
}

function toTemplate(v: unknown): PaymentTemplate | null {
  if (!isRecord(v)) return null;
  if (!nonEmptyString(v.id) || !nonEmptyString(v.name) || !nonEmptyString(v.contactAddress)
    || !nonEmptyString(v.chain) || !nonEmptyString(v.assetKey)) return null;
  const t: PaymentTemplate = {
    id: v.id,
    name: v.name,
    contactAddress: v.contactAddress,
    chain: v.chain,
    assetKey: v.assetKey,
    createdAt: typeof v.createdAt === "number" && Number.isFinite(v.createdAt) ? v.createdAt : Date.now(),
  };
  if (typeof v.amount === "string") t.amount = v.amount;
  if (typeof v.memo === "string") t.memo = v.memo;
  return t;
}

/** Parse an untrusted JSON array into validated contacts, dropping bad rows. */
export function sanitizeContacts(raw: unknown): Contact[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(toContact).filter((c): c is Contact => c !== null);
}

export function sanitizeTemplates(raw: unknown): PaymentTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(toTemplate).filter((t): t is PaymentTemplate => t !== null);
}

/** Favorites first, then most-recently-used, then alphabetical by name. */
export function sortContacts(contacts: readonly Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1;
    const au = a.lastUsedAt ?? 0;
    const bu = b.lastUsedAt ?? 0;
    if (au !== bu) return bu - au;
    return a.name.localeCompare(b.name);
  });
}

function parse(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadContacts(): Contact[] {
  return sortContacts(sanitizeContacts(parse(CONTACTS_KEY)));
}

function saveContacts(contacts: Contact[]): void {
  localStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

export function addContact(contact: Contact): Contact[] {
  const contacts = sanitizeContacts(parse(CONTACTS_KEY));
  const exists = contacts.some((c) => c.chain === contact.chain && sameAddress(c.address, contact.address, contact.chain));
  if (!exists) contacts.push({ createdAt: Date.now(), ...contact });
  saveContacts(contacts);
  return sortContacts(contacts);
}

export function removeContact(address: string, chain: string): Contact[] {
  const contacts = sanitizeContacts(parse(CONTACTS_KEY)).filter(
    (c) => !(c.chain === chain && sameAddress(c.address, address, chain)),
  );
  saveContacts(contacts);
  return sortContacts(contacts);
}

/** Merge a partial patch into a matching contact (e.g. note/favorite edits). */
export function updateContact(address: string, chain: string, patch: Partial<Contact>): Contact[] {
  const contacts = sanitizeContacts(parse(CONTACTS_KEY)).map((c) =>
    c.chain === chain && sameAddress(c.address, address, chain) ? { ...c, ...patch } : c,
  );
  saveContacts(contacts);
  return sortContacts(contacts);
}

/** Stamp a contact as just-used (no-op if it isn't saved). Call after a send. */
export function touchContact(address: string, chain: string): Contact[] {
  return updateContact(address, chain, { lastUsedAt: Date.now() });
}

export function loadTemplates(): PaymentTemplate[] {
  return sanitizeTemplates(parse(TEMPLATES_KEY));
}

function saveTemplates(templates: PaymentTemplate[]): void {
  localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

export function addTemplate(template: PaymentTemplate): PaymentTemplate[] {
  const templates = sanitizeTemplates(parse(TEMPLATES_KEY));
  templates.push(template);
  saveTemplates(templates);
  return templates;
}

export function removeTemplate(id: string): PaymentTemplate[] {
  const templates = sanitizeTemplates(parse(TEMPLATES_KEY)).filter((t) => t.id !== id);
  saveTemplates(templates);
  return templates;
}
