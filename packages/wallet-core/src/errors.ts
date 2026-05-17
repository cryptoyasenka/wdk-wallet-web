/**
 * Typed error surface for the wallet engine.
 *
 * Apps switch on these (e.g. show "unlock" UI on `WalletLockedError`, a phase
 * banner on `PhaseNotImplementedError`) so no caller has to string-match
 * `message`. Every throw path in the engine uses one of these.
 */

/** Base class for every error this package throws. */
export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Restore prototype chain across the ES5 `extends Error` gap so
    // `instanceof` works after transpilation/bundling.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A wallet already exists in storage; refuse to clobber existing key material. */
export class WalletExistsError extends WalletError {
  constructor() {
    super("a wallet already exists in this storage; refusing to overwrite it");
  }
}

/** No wallet has been created or imported into this storage yet. */
export class NoWalletError extends WalletError {
  constructor() {
    super("no wallet found in storage; create or import one first");
  }
}

/** An operation needs the wallet unlocked, but it is locked. */
export class WalletLockedError extends WalletError {
  constructor() {
    super("wallet is locked; call unlock() first");
  }
}

/** The provided BIP-39 seed phrase did not validate. */
export class InvalidSeedPhraseError extends WalletError {
  constructor() {
    super("invalid BIP-39 seed phrase");
  }
}

/** A chain was requested that this build is not configured for. */
export class UnsupportedChainError extends WalletError {
  constructor(chain: string) {
    super(`chain "${chain}" is not configured in this build`);
  }
}

/** An asset/operation combination this build cannot serve (e.g. token on BTC). */
export class UnsupportedAssetError extends WalletError {
  constructor(detail: string) {
    super(`unsupported asset operation: ${detail}`);
  }
}

/**
 * A method that is part of the frozen public contract but is delivered in a
 * later phase. The contract is intentionally complete from day one so apps can
 * compile against it; this error makes the phase boundary explicit at runtime
 * instead of silently returning empty/wrong data.
 */
export class PhaseNotImplementedError extends WalletError {
  readonly phase: number;
  constructor(method: string, phase: number) {
    super(`${method}() is implemented in phase ${phase} (see docs/ARCHITECTURE.md → Phasing)`);
    this.phase = phase;
  }
}
