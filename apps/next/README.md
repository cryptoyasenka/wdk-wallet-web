# apps/next — reference web wallet

Next.js App Router app consuming `@wdk-web/wallet-core`. Screen parity with
`tetherto/wdk-starter-react-native`.

**Boundary rule:** no `@tetherto/*` import anywhere under `apps/`. The app only
provides web implementations of the injected ports and renders UI.

`src/lib/` (Phase 1) supplies the injected web host ports:
- `IndexedDbStorage` → `StorageAdapter` (raw IndexedDB, zero extra deps)
- `PassphraseUnlock` → `UnlockProvider` (PBKDF2 via wallet-core's
  `deriveAesGcmKey`; per-vault salt persisted in IndexedDB beside the blob)
- `StubCryptoWorker` → `CryptoWorker` (`lock()` is a real no-op; address
  derivation / signing intentionally throw — Phase 2)
- `getWalletApp()` wires the ports + env-driven `buildChainRegistry` into the
  public `createWalletEngine` factory as a memoised client singleton

Honest Phase-2 boundary: passkey (WebAuthn) unlock and true in-Web-Worker key
isolation pair with transaction signing in Phase 2 — the frozen `CryptoWorker`
port has no seed-provisioning method, so Phase 1 decrypts in-process and the
core still calls `lock()` for forward-compatibility. See
`../../docs/SECURITY.md` and `../../docs/ARCHITECTURE.md` → Phasing.

Screens (parity target): onboarding → wallet-setup → unlock → portfolio → token
detail → send → receive → activity → settings.

Phase 1 ships: onboarding (create + import), unlock, portfolio, receive — one
client-side state machine in `app/page.tsx`. Send / activity / passkey = Phase 2.
