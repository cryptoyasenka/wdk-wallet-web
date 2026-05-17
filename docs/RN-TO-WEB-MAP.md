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
| Bitcoin Electrum | `react-native-tcp-socket` | **Electrum-over-WebSocket** relay (or WDK Indexer) | Browser cannot open raw TCP; needs a WS-to-Electrum relay or the hosted Indexer. |
| Live balances/activity | WDK Indexer | WDK Indexer (unchanged) | Portable as-is. |
| UI kit | `@tetherto/wdk-uikit-react-native` | Tailwind + shadcn/ui (web components) | Visual parity by design; no shared component code. |
| Node polyfills | metro polyfills | webpack/turbopack `crypto`/`buffer`/`stream` polyfills | Build-config only; documented in ARCHITECTURE.md. |
| Navigation | Expo Router + native gestures | Next.js App Router | Portable patterns; standard web nav. |
| Animations | Reanimated | CSS / Framer Motion | Cosmetic. |

**Portable as-is (copied, not rewritten):** WDK provider/orchestration layer,
`config/` (networks, assets, chains, failover/RPC), `services/` (pricing), `utils/`
(formatters). This is exactly the platform-agnostic boundary Tether already drew in
their RN starter — `wallet-core` makes it explicit and enforced by the package
boundary.
