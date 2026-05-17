# apps/next — reference web wallet

Next.js App Router app consuming `@wdk-web/wallet-core`. Screen parity with
`tetherto/wdk-starter-react-native`.

**Boundary rule:** no `@tetherto/*` import anywhere under `apps/`. The app only
provides web implementations of the injected ports and renders UI.

`src/lib/` (Phase 1) supplies:
- `IndexedDbStorage` → `StorageAdapter`
- `WebCryptoWorker` (Web Worker) → `CryptoWorker`
- `WebAuthnUnlock` → `UnlockProvider`

Screens (parity target): onboarding → wallet-setup → unlock → portfolio → token
detail → send → receive → activity → settings.

Phase 1 ships: onboarding, unlock, portfolio, receive. See
`../../docs/ARCHITECTURE.md` → Phasing.
