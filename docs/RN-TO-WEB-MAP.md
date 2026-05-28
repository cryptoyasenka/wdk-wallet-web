# RN → Web replacement map

Tether's `wdk-starter-react-native` leans on native APIs that have no drop-in web
equivalent. This table is the contract for the web port: every platform-specific RN
piece, its web-native replacement, and the honest delta. (Reviewers: this is the part
that separates a port from a paste.)

| Concern | RN starter | Web replacement | Honest delta |
|---|---|---|---|
| Crypto isolation | BareKit worklet (separate runtime) | Dedicated **Web Worker** owns `openSeed` + the WDK signer; main thread holds an opaque `WdkAdapter` postMessage proxy (ADR-004) | Steady state (unlock → sign → lock) is worker-only; **create/import unavoidably touch the main thread** (backup screen / user input — DOM is main-thread; RN starter has the same property). A Web Worker is **not** an XSS boundary like a separate runtime — defense-in-depth only, stated in SECURITY.md. |
| Key storage at rest | iOS Keychain / Android KeyStore | **WebCrypto** (AES-GCM) + key from WebAuthn/passphrase, ciphertext in **encrypted IndexedDB** | No hardware-backed keystore in-browser by default; passkey/WebAuthn gives hardware-backed *unlock*, not at-rest HSM. |
| Unlock / auth | Face ID / Touch ID | **WebAuthn passkey PRF** (CTAP2 `hmac-secret`) → HKDF→AES-GCM key; **PBKDF2-600k passphrase** fallback (ADR-005) | Equivalent UX, stronger phishing resistance. The key is the PRF *secret*, never a (non-deterministic) signature. **PRF support is narrower than passkey support** (≈ Safari 18+, Firefox 148+, Chrome 147+/Win Hello), so the passphrase is a first-class path, not a degraded one; selection prefers the passkey only when one is actually enrolled in this wallet. |
| QR scan | native camera | `getUserMedia()` + `zxing`/`jsQR` | Requires HTTPS + camera permission; otherwise equivalent. |
| Bitcoin Electrum | `react-native-tcp-socket` | **Electrum-over-WebSocket** relay (or WDK Indexer) | Browser cannot open raw TCP; the BTC manager takes an **injected Electrum-WS client** over the native `WebSocket` (relay or hosted Indexer). Shipped — see "Bitcoin on web" below. |
| Live balances/activity | WDK Indexer | Balances via WDK read-only accounts; **activity via a local outgoing send-log** (alpha WDK ships no history/list API — only per-hash receipts) | Outgoing-only + this-wallet-via-this-app-only until a WDK Indexer/explorer lands — see ARCHITECTURE.md ADR-003. Entry status is read from the on-chain receipt, never fabricated. |
| UI kit | `@tetherto/wdk-uikit-react-native` | Tailwind + shadcn/ui (web components) | Visual parity by design; no shared component code. |
| Node polyfills | metro polyfills | webpack/turbopack `crypto`/`buffer`/`stream` polyfills | Build-config only; documented in ARCHITECTURE.md. |
| Navigation | Expo Router + native gestures | Next.js App Router | Portable patterns; standard web nav. |
| Animations | Reanimated | CSS / Framer Motion | Cosmetic. |

## Bitcoin on web (shipped)

The RN→web Bitcoin delta was **larger than just the TCP transport**: the alpha
WDK's BTC package did not bundle for a browser out of the box. That was an
**alpha-WDK packaging gap, not a web-platform limit** — and it is closed.
`@tetherto/wdk-wallet-btc`'s browser `default` entry is pure-JS (bitcoinjs-lib,
bip32/39, `@bitcoinerlab/secp256k1`); the BTC manager takes an **injected
Electrum-WS client** that speaks to an Electrum server over the native
`WebSocket` (no raw TCP). Real BTC — address derive, balance, receive, quote,
send — runs client-side in the WDK worker.

**What bundles it (both apps, symmetric, honest):**

| Concern | Web behaviour (shipped) | Honest delta |
|---|---|---|
| BTC key/crypto deps | `sodium-universal` aliased (app bundle only) to a shim re-exporting **real** pure-JS `sodium_memzero` from `sodium-javascript` | No faked crypto — real libsodium zeroisation; identical to `sodium-universal`'s own browser target. |
| `Buffer` | `buffer` npm shim + a global `Buffer` (webpack `ProvidePlugin` / Vite `@rollup/plugin-inject`, incl. the worker chunk) | bitcoinjs-lib reads a bare global `Buffer`; the shim is the standard pure-JS implementation. |
| `ws` / `ledger-bitcoin` | resolved to an empty module | `ws` is only imported in a dead `isNodeOrBare` branch (browser uses `globalThis.WebSocket`); `ledger-bitcoin` is an optional peer for Ledger hardware signing this software wallet never does. |
| `wallet-core` itself | **Untouched** — Node/RN consumers keep the same code | The containment boundary holds; only each app's bundler config is reshaped. |

**Residual (honest, real — unlike a missing feature):** the app needs a
**public Electrum-WS endpoint** to point at (env-driven:
`NEXT_PUBLIC_BTC_ELECTRUM_WS_URL` / `VITE_BTC_ELECTRUM_WS_URL`; unset → the BTC
chain is simply not registered). A third-party WS-Electrum server is a trust/
uptime dependency; the documented mitigation is an endpoint array via
`@tetherto/wdk-failover-provider`. This is a real, defensible operational limit
— not fake parity — and it is the only thing between the shipped code and a
running BTC wallet.

**Verified empirically:** `corepack pnpm verify` is green in both apps; the BTC crypto graph
lands in the code-split WDK worker chunk, off the main thread (no `@tetherto/*`
in First Load). Current First Load: Next ≈ 238 kB, Svelte main ≈ 226 kB — the
post-P1 growth is the app-side QR codec (`qrcode-generator` + `jsqr`), not WDK.

**Portable as-is (copied, not rewritten):** WDK provider/orchestration layer,
`config/` (networks, assets, chains, failover/RPC), `services/` (pricing), `utils/`
(formatters). This is exactly the platform-agnostic boundary Tether already drew in
their RN starter — `wallet-core` makes it explicit and enforced by the package
boundary.
