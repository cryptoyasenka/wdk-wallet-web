# apps/next: reference web wallet

Next.js App Router app consuming `@wdk-web/wallet-core`. Screen parity with
`tetherto/wdk-starter-react-native`.

**Boundary rule:** no `@tetherto/*` import anywhere under `apps/`. The app only
provides web implementations of the injected ports and renders UI.

`src/lib/` supplies the injected web host ports:
- `IndexedDbStorage` → `StorageAdapter` (raw IndexedDB, zero extra deps)
- `SelectingUnlockProvider` → `UnlockProvider`, routing to a WebAuthn passkey
  (PRF → HKDF) when one is enrolled in this wallet, else the `PassphraseUnlock`
  path (PBKDF2 via wallet-core's `deriveAesGcmKey`; per-vault salt persisted in
  IndexedDB beside the blob). PRF support is narrower than passkey support, so
  the passphrase is a first-class path (`../../docs/ARCHITECTURE.md` → ADR-005)
- `StubCryptoWorker` → `CryptoWorker` (`lock()` is a real no-op; address
  derivation / signing reject loudly. **Intentional architecture, not a
  pending stub**: the real seed isolation lives behind the WDK adapter's
  Dedicated Web Worker, not this port; `../../docs/ARCHITECTURE.md` → ADR-004)
- `getWalletApp()` wires the ports + env-driven `buildChainRegistry` into the
  public `createWalletEngine` factory as a memoised client singleton

Seed isolation (shipped): in the operational steady state (unlock → derive →
quote → send → lock) the decrypted seed and the WDK signer exist only inside a
Dedicated Web Worker; the main thread holds an opaque postMessage proxy. A Web
Worker is defense-in-depth, not an XSS boundary; create/import unavoidably
touch the main thread. See `../../docs/SECURITY.md` and
`../../docs/ARCHITECTURE.md` → ADR-004.

Screens (parity target): onboarding → wallet-setup → unlock → portfolio → token
detail → send → receive → activity → settings.

Ships: onboarding (create + import), unlock (passkey or passphrase), portfolio,
receive, send (itemised decoded confirmation), and activity (a local outgoing
send-log; `../../docs/ARCHITECTURE.md` → ADR-003), all in one client-side state
machine in `app/page.tsx`.
