# RN → Web replacement map

Tether's `wdk-starter-react-native` leans on native APIs that have no drop-in web
equivalent. This table is the contract for the web port: every platform-specific RN
piece, its web-native replacement, and the honest delta. (Reviewers: this is the part
that separates a port from a paste.)

| Concern | RN starter | Web replacement | Honest delta |
|---|---|---|---|
| Crypto isolation | BareKit worklet (separate runtime) | Dedicated crypto module in a **Web Worker** | A Web Worker is **not** an XSS boundary like a separate runtime. Defense-in-depth only — stated in SECURITY.md. |
| Key storage at rest | iOS Keychain / Android KeyStore | **WebCrypto** (AES-GCM) + key from WebAuthn/passphrase, ciphertext in **encrypted IndexedDB** | No hardware-backed keystore in-browser by default; passkey/WebAuthn gives hardware-backed *unlock*, not at-rest HSM. |
| Unlock / auth | Face ID / Touch ID | **WebAuthn / passkey**; passphrase fallback | Equivalent UX, stronger phishing resistance; availability varies by browser. |
| QR scan | native camera | `getUserMedia()` + `zxing`/`jsQR` | Requires HTTPS + camera permission; otherwise equivalent. |
| Bitcoin Electrum | `react-native-tcp-socket` | **Electrum-over-WebSocket** relay (or WDK Indexer) | Browser cannot open raw TCP; needs a WS-to-Electrum relay or the hosted Indexer. **Plus** a newly found bundling blocker — see "Bitcoin on web (P1 status)" below. |
| Live balances/activity | WDK Indexer | Balances via WDK read-only accounts; **activity via a local outgoing send-log** (alpha WDK ships no history/list API — only per-hash receipts) | Outgoing-only + this-wallet-via-this-app-only until a WDK Indexer/explorer lands — see ARCHITECTURE.md ADR-003. Entry status is read from the on-chain receipt, never fabricated. |
| UI kit | `@tetherto/wdk-uikit-react-native` | Tailwind + shadcn/ui (web components) | Visual parity by design; no shared component code. |
| Node polyfills | metro polyfills | webpack/turbopack `crypto`/`buffer`/`stream` polyfills | Build-config only; documented in ARCHITECTURE.md. |
| Navigation | Expo Router + native gestures | Next.js App Router | Portable patterns; standard web nav. |
| Animations | Reanimated | CSS / Framer Motion | Cosmetic. |

## Bitcoin on web (P1 status)

The RN→web Bitcoin delta is **larger than just the TCP transport**. Building the
web bundle surfaced a second, harder blocker in the alpha WDK itself:

- `@tetherto/wdk-wallet-btc` (and the EVM package's memory-safe key modules) import
  `sodium-universal`, which is CJS `module.exports = require('sodium-native')` — a
  Node N-API **native addon** — alongside Bare-runtime modules. None of that bundles
  for a browser; the Electrum-over-WS relay does not even get a chance to matter.
- This is an **alpha-WDK packaging gap**, not a web-platform limit: the package
  ships no working browser build for its own `browser` field (it points at
  `sodium-javascript`, which the dependency tree does not install).

**P1 decision — the web app is EVM-only, stated honestly:**

| Concern | P1 web behaviour | Honest delta |
|---|---|---|
| BTC key/crypto deps | `sodium-universal` aliased (this app's bundle only) to a shim re-exporting **real** pure-JS `sodium_memzero` from `sodium-javascript` | No faked crypto — real libsodium zeroisation; identical behaviour to `sodium-universal`'s own browser target. |
| BTC wallet adapter | `@tetherto/wdk-wallet-btc` aliased (this app's bundle only) to a typed stub that **throws** on construction | The BTC path is unreachable on P1 screens (EVM-only scope). A loud throw cannot masquerade as a working wallet. |
| `wallet-core` itself | **Untouched** — Node/RN consumers keep the real BTC adapter and real native sodium | The containment boundary holds; only `apps/next`'s webpack bundle is reshaped. |

**P2 web Bitcoin plan:** revisit once the `sodium-native`/Bare-runtime story is
either fixed upstream or replaced with a maintained pure-JS path; pair it with the
Electrum-over-WebSocket relay (or hosted Indexer) the table above already specifies.
Until then, advertising BTC on web would be the kind of fake-parity SECURITY.md
forbids.

**Portable as-is (copied, not rewritten):** WDK provider/orchestration layer,
`config/` (networks, assets, chains, failover/RPC), `services/` (pricing), `utils/`
(formatters). This is exactly the platform-agnostic boundary Tether already drew in
their RN starter — `wallet-core` makes it explicit and enforced by the package
boundary.
