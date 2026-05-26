/**
 * Address book (saved contacts) persisted in localStorage.
 *
 * Each contact has a human name, a blockchain address, and the chain it
 * belongs to. This keeps the Send form from requiring manual entry every
 * time and reduces the risk of address typos.
 */

export interface Contact {
  name: string;
  address: string;
  chain: string;
}

const STORAGE_KEY = "wdk-contacts";

export function loadContacts(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveContacts(contacts: Contact[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

export function addContact(contact: Contact): Contact[] {
  const contacts = loadContacts();
  // Deduplicate by address+chain
  const exists = contacts.some(
    (c) => c.address === contact.address && c.chain === contact.chain,
  );
  if (!exists) contacts.push(contact);
  saveContacts(contacts);
  return contacts;
}

export function removeContact(address: string, chain: string): Contact[] {
  const contacts = loadContacts().filter(
    (c) => !(c.address === address && c.chain === chain),
  );
  saveContacts(contacts);
  return contacts;
}
