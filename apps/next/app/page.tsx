"use client";

/**
 * The whole wallet UI as one client-side state machine.
 *
 * Features:
 *   Phase 1 — create / import / seed-quiz / unlock / portfolio / receive /
 *     send / itemised tx-confirm / activity (ADR-003)
 *   Phase 2 — toast notifications, auto-lock timer, USD prices (CoinGecko),
 *     address book, Max button, explorer links, improved empty states
 *   Phase 3 — settings page, PWA, recovery check, sparkline charts, i18n (EN/RU)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  InvalidSeedPhraseError,
  UnsupportedChainError,
  VaultDecryptError,
  WalletError,
  WalletExistsError,
  DEFAULT_ASSETS,
  type ActivityItem,
  type Asset,
  type Balance,
  type ChainId,
  type FeeQuote,
  type TxIntent,
} from "@wdk-web/wallet-core";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import { getWalletApp, resetWalletApp } from "@/lib/engine";
import { loadDataSources, saveDataSources, type DataSources, type IndexerMode } from "@/lib/dataSources";
import { extractAddress } from "@/lib/extract-address";
import { isWebAuthnSupported } from "@/lib/webauthnUnlock";
import { explorerUrl, addressExplorerUrl } from "@/lib/explorer";
import { fetchPrices, fetchSparkline, formatUsd, type PriceMap } from "@/lib/prices";
import {
  loadContacts, addContact, removeContact, touchContact, updateContact,
  loadTemplates, addTemplate, removeTemplate,
  type Contact, type PaymentTemplate,
} from "@/lib/contacts";
import { buildPaymentRequestUri, canBuildRequest, InvalidAmountError } from "@/lib/paymentRequest";
import { classifyRecipient, detectPoisoning, isOfficialToken, officialTokenContracts } from "@/lib/safety";
import {
  WATCH_CHAINS, addWatchWallet, removeWatchWallet, loadWatchWallets,
  isValidEvmAddress, watchChainToChainId,
  type WatchedWallet, type WatchChain,
} from "@/lib/watchOnly";
import { t, getLocale, setLocale as persistLocale, type Locale } from "@/lib/i18n";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDownRight, ArrowUpRight, CopyIcon, Loader2, Plus,
  Pencil, LogOut, Check, X, Settings, ExternalLink, BookUser,
  Shield, Trash2, Globe, Timer, UserPlus, CheckCircle2, XCircle, Info, AlertTriangle,
  Star, FileText, Eye,
} from "lucide-react";

type Phase = "loading" | "onboarding" | "backup" | "quiz" | "locked" | "unlocked" | "settings" | "watch";
type OnboardMode = "create" | "import" | "watch";
type ToastType = "success" | "error" | "info";
interface ToastItem { id: number; type: ToastType; message: string }

const RECEIVE_CHAINS: readonly ChainId[] = ["bitcoin", "ethereum"];
const WALLET_NAMES_KEY = "wdk-wallet-names";
const LOCAL_STORAGE_KEYS_ON_WALLET_DELETE = [WALLET_NAMES_KEY, "wdk-contacts", "wdk-templates"] as const;
const AUTO_LOCK_KEY = "wdk-autolock-min";
const DEFAULT_AUTOLOCK_MIN = 5;

// BIP-39 word list subset for quiz decoys (common, non-confusing words)
const DECOY_WORDS = [
  "abandon","ability","able","about","above","absent","absorb","abstract",
  "absurd","abuse","access","accident","account","accuse","achieve","acid",
  "acoustic","acquire","across","act","action","actor","actual","adapt",
  "add","addict","address","adjust","admit","adult","advance","advice",
  "aerobic","afraid","again","age","agent","agree","ahead","aim","air",
  "airport","aisle","alarm","album","alcohol","alert","alien","all",
  "alley","allow","almost","alone","alpha","already","also","alter",
  "always","amazing","among","amount","amused","analyst","anchor","ancient",
  "anger","angle","angry","animal","ankle","announce","annual","another",
  "answer","antenna","apple","area","arena","argue","army","arrow",
];

/** bigint minor units → decimal string, trailing zeros trimmed. */
function formatUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const neg = amount < 0n;
  const digits = (neg ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

function parseUnits(input: string, decimals: number): bigint {
  const s = input.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("Enter a positive amount, e.g. 12.5");
  const dot = s.indexOf(".");
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? "" : s.slice(dot + 1);
  if (frac.length > decimals) {
    throw new Error(`Too many decimal places — this asset has ${decimals}.`);
  }
  const value = BigInt(whole + frac.padEnd(decimals, "0"));
  if (value <= 0n) throw new Error("Amount must be greater than zero.");
  return value;
}

function assetKey(a: Asset): string {
  return `${a.symbol}-${a.chain}`;
}

function statusClass(status: ActivityItem["status"]): string {
  if (status === "confirmed") return "bg-green-500/15 text-green-300";
  if (status === "failed") return "bg-red-500/15 text-red-300";
  return "bg-yellow-500/15 text-yellow-300";
}

function messageFor(err: unknown): string {
  if (err instanceof VaultDecryptError) return "Wrong passphrase, or the vault is corrupt.";
  if (err instanceof InvalidSeedPhraseError) return "That is not a valid BIP-39 seed phrase.";
  if (err instanceof WalletExistsError) return "A wallet already exists on this device.";
  if (err instanceof WalletError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

/** Generate 3 quiz questions from a seed phrase */
function generateQuiz(seed: string): { index: number; correct: string; options: string[] }[] {
  const words = seed.split(" ");
  const positions: number[] = [];
  while (positions.length < 3) {
    const idx = Math.floor(Math.random() * words.length);
    if (!positions.includes(idx)) positions.push(idx);
  }
  positions.sort((a, b) => a - b);
  return positions.map((idx) => {
    const correct = words[idx]!;
    const decoys: string[] = [];
    while (decoys.length < 3) {
      const d = DECOY_WORDS[Math.floor(Math.random() * DECOY_WORDS.length)]!;
      if (!words.includes(d) && !decoys.includes(d)) decoys.push(d);
    }
    const options = [correct, ...decoys].sort(() => Math.random() - 0.5);
    return { index: idx, correct, options };
  });
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [mode, setMode] = useState<OnboardMode>("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [passphrase, setPassphrase] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [seedInput, setSeedInput] = useState("");
  const [revealedSeed, setRevealedSeed] = useState("");
  const [backedUp, setBackedUp] = useState(false);

  const [balances, setBalances] = useState<readonly Balance[] | null>(null);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<ReadonlyArray<readonly [ChainId, string]>>([]);
  const [receiveMode, setReceiveMode] = useState<"address" | "request">("address");
  const [activeAccount, setActiveAccount] = useState(0);
  const [accountCount, setAccountCount] = useState(1);
  const [activeWallet, setActiveWallet] = useState(0);
  const [walletCount, setWalletCount] = useState(0);

  const [sendAssetKey, setSendAssetKey] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [quote, setQuote] = useState<{ readonly intent: TxIntent; readonly fee: FeeQuote } | null>(null);
  const [sentHash, setSentHash] = useState<string | null>(null);
  const [activity, setActivity] = useState<readonly ActivityItem[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [webauthnOk, setWebauthnOk] = useState(false);
  const [passkeyAdded, setPasskeyAdded] = useState(false);

  // ---- Wallet names ----
  const [walletNames, setWalletNames] = useState<Record<number, string>>({});
  const [editingWalletIndex, setEditingWalletIndex] = useState<number | null>(null);
  const [editWalletNameInput, setEditWalletNameInput] = useState("");

  // ---- Toast system ----
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = useRef(0);
  const addToast = useCallback((type: ToastType, message: string) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  // ---- i18n ----
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => { setLocaleState(getLocale()); }, []);
  const changeLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    persistLocale(l);
  }, []);
  const T = useCallback((key: string) => t(key, locale), [locale]);

  // ---- USD prices ----
  const [prices, setPrices] = useState<PriceMap>({});
  const [sparklineData, setSparklineData] = useState<number[]>([]);

  // ---- Contacts ----
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [templates, setTemplates] = useState<PaymentTemplate[]>([]);

  // Watch-only (Phase 5): seedless read-only monitoring of external addresses.
  const [watchWallets, setWatchWallets] = useState<WatchedWallet[]>([]);
  const [activeWatchId, setActiveWatchId] = useState<string | null>(null);
  const [watchChainInput, setWatchChainInput] = useState<WatchChain>("ethereum");
  const [watchAddressInput, setWatchAddressInput] = useState("");
  const [watchLabelInput, setWatchLabelInput] = useState("");

  // ---- Contacts add inline form states ----
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactAddress, setNewContactAddress] = useState("");
  const [newContactChain, setNewContactChain] = useState("ethereum");
  const [newContactNote, setNewContactNote] = useState("");

  // ---- Contact edit + save-as-template inline states (keyed by `${address}-${chain}`) ----
  const [editingContactKey, setEditingContactKey] = useState<string | null>(null);
  const [editContactName, setEditContactName] = useState("");
  const [editContactNote, setEditContactNote] = useState("");
  const [templatingContactKey, setTemplatingContactKey] = useState<string | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateAssetKey, setNewTemplateAssetKey] = useState("");
  const [newTemplateAmount, setNewTemplateAmount] = useState("");

  // ---- Settings: delete wallet confirmation ----
  const [confirmDeleteWallet, setConfirmDeleteWallet] = useState(false);

  // ---- Data Sources / Privacy form (text drafts; lists are comma/newline) ----
  const [dsForm, setDsForm] = useState({
    ethereumRpcUrls: "", polygonRpcUrls: "", arbitrumRpcUrls: "", plasmaRpcUrls: "",
    btcElectrumWsUrl: "", indexerMode: "local" as IndexerMode, indexerUrl: "",
    pricesEnabled: true, priceEndpoint: "",
  });
  useEffect(() => {
    const ds = loadDataSources();
    setDsForm({
      ethereumRpcUrls: ds.ethereumRpcUrls.join("\n"),
      polygonRpcUrls: ds.polygonRpcUrls.join("\n"),
      arbitrumRpcUrls: ds.arbitrumRpcUrls.join("\n"),
      plasmaRpcUrls: ds.plasmaRpcUrls.join("\n"),
      btcElectrumWsUrl: ds.btcElectrumWsUrl,
      indexerMode: ds.indexerMode,
      indexerUrl: ds.indexerUrl,
      pricesEnabled: ds.pricesEnabled,
      priceEndpoint: ds.priceEndpoint,
    });
  }, []);

  // ---- Post-send inline save contact states ----
  const [newContactSendName, setNewContactSendName] = useState("");
  const [isContactSavedPostSend, setIsContactSavedPostSend] = useState(false);
  const [lastSentRecipient, setLastSentRecipient] = useState("");
  const [lastSentChain, setLastSentChain] = useState<ChainId>("ethereum");

  // ---- Auto-lock ----
  const [autolockMin, setAutolockMin] = useState(DEFAULT_AUTOLOCK_MIN);
  const lastActivityRef = useRef(Date.now());

  // ---- Settings: recovery check ----
  const [settingsPassphrase, setSettingsPassphrase] = useState("");
  const [settingsRevealedSeed, setSettingsRevealedSeed] = useState<string | null>(null);

  // ---- Seed quiz state ----
  const [quizQuestions, setQuizQuestions] = useState<ReturnType<typeof generateQuiz>>([]);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, string>>({});

  // Init wallet names from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(WALLET_NAMES_KEY);
      if (stored) setWalletNames(JSON.parse(stored));
    } catch {
      // Non-secret display metadata; ignore malformed local values.
    }
  }, []);

  // Init autolock from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTO_LOCK_KEY);
      if (stored) setAutolockMin(Number(stored));
    } catch {
      // Keep the default timer if localStorage is unavailable or malformed.
    }
  }, []);

  // Init contacts + payment templates from localStorage
  useEffect(() => {
    setContacts(loadContacts());
    setTemplates(loadTemplates());
  }, []);

  // Init watch-only wallets from localStorage
  useEffect(() => {
    setWatchWallets(loadWatchWallets());
  }, []);

  const activeWatch = useMemo(
    () => watchWallets.find((w) => w.id === activeWatchId) ?? null,
    [watchWallets, activeWatchId],
  );

  const clearSession = useCallback(() => {
    setBalances(null);
    setAddresses([]);
    setActiveAccount(0);
    setAccountCount(1);
    setQuote(null);
    setSentHash(null);
    setSendTo("");
    setSendAmount("");
    setActivity(null);
    setActivityError(null);
    setPasskeyAdded(false);
    setPrices({});
    setSparklineData([]);
    setIsContactSavedPostSend(false);
    setNewContactSendName("");
  }, []);

  const autoLock = useCallback(async () => {
    try {
      await getWalletApp().engine.lock();
      clearSession();
      setPhase("locked");
      addToast("info", T("toast.autolock"));
    } catch {
      // Locking is best-effort during idle teardown.
    }
  }, [addToast, T, clearSession]);

  // ---- Auto-lock timer ----
  useEffect(() => {
    if (phase !== "unlocked" && phase !== "settings") return;

    const resetTimer = () => { lastActivityRef.current = Date.now(); };
    const events = ["mousedown", "keypress", "scroll", "touchstart"] as const;
    for (const e of events) document.addEventListener(e, resetTimer, { passive: true });

    const handleVisibility = () => {
      if (document.hidden) return;
      // Re-check when tab becomes visible
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed > autolockMin * 60_000) {
        void autoLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed > autolockMin * 60_000) {
        void autoLock();
      }
    }, 10_000); // check every 10 seconds

    return () => {
      for (const e of events) document.removeEventListener(e, resetTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(interval);
    };
  }, [phase, autolockMin, autoLock]);

  // ---- Wallet rename helpers ----
  const renameWallet = (index: number) => {
    const current = walletNames[index] || `Wallet #${index}`;
    setEditingWalletIndex(index);
    setEditWalletNameInput(current);
  };

  const saveWalletName = () => {
    if (editingWalletIndex !== null) {
      const trimmed = editWalletNameInput.trim();
      if (trimmed) {
        const updated = { ...walletNames, [editingWalletIndex]: trimmed };
        setWalletNames(updated);
        localStorage.setItem(WALLET_NAMES_KEY, JSON.stringify(updated));
        addToast("success", T("toast.wallet_renamed"));
      }
      setEditingWalletIndex(null);
    }
  };

  const cancelWalletRename = () => {
    setEditingWalletIndex(null);
  };

  /** Run a wallet-core call with shared busy/error handling. */
  const act = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadWalletMeta = useCallback(async () => {
    const { engine } = getWalletApp();
    setActiveWallet(await engine.getActiveWallet());
    setWalletCount(await engine.getWalletCount());
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { engine } = getWalletApp();
        const has = await engine.hasWallet();
        if (!alive) return;
        await loadWalletMeta();
        if (alive) setPhase(has ? "locked" : "onboarding");
      } catch (e) {
        if (alive) {
          setError(messageFor(e));
          setPhase("onboarding");
        }
      }
    })();
    return () => { alive = false; };
  }, [loadWalletMeta]);

  useEffect(() => {
    setWebauthnOk(isWebAuthnSupported());
  }, []);

  const loadActivity = useCallback(async () => {
    setActivityError(null);
    try {
      setActivity(await getWalletApp().engine.getActivity());
    } catch (e) {
      setActivity(null);
      setActivityError(messageFor(e));
    }
  }, []);

  const loadPrices = useCallback(async () => {
    const p = await fetchPrices();
    setPrices(p);
  }, []);

  const loadSparkline = useCallback(async () => {
    const data = await fetchSparkline("BTC");
    if (data.length > 0) setSparklineData(data);
  }, []);

  const loadUnlockedView = useCallback(async () => {
    const { engine } = getWalletApp();

    await loadWalletMeta();

    const acct = await engine.getActiveAccount();
    setActiveAccount(acct);
    setAccountCount((c) => Math.max(c, acct + 1));

    const found: Array<readonly [ChainId, string]> = [];
    for (const chain of RECEIVE_CHAINS) {
      try {
        found.push([chain, await engine.getAddress(chain, acct)]);
      } catch (e) {
        if (!(e instanceof UnsupportedChainError)) throw e;
      }
    }
    setAddresses(found);

    setBalancesError(null);
    try {
      setBalances(await engine.getBalances());
    } catch (e) {
      setBalances(null);
      setBalancesError(messageFor(e));
    }

    await loadActivity();
    void loadPrices();
    void loadSparkline();
  }, [loadActivity, loadWalletMeta, loadPrices, loadSparkline]);

  /**
   * Read-only portfolio for a watched address — the seedless engine path
   * (`getBalancesForAddress`). No unlock, no signer, no activity: a watch-only
   * session can show balances but never sign. Constructing the engine is inert,
   * so this works with no wallet at all.
   */
  const loadWatchView = useCallback(
    async (w: WatchedWallet) => {
      setBalances(null);
      setBalancesError(null);
      try {
        const { engine } = getWalletApp();
        setBalances(
          await engine.getBalancesForAddress(w.address, { chains: [watchChainToChainId(w.chain)] }),
        );
      } catch (e) {
        setBalances(null);
        setBalancesError(messageFor(e));
      }
      void loadPrices();
      void loadSparkline();
    },
    [loadPrices, loadSparkline],
  );

  const onStartWatch = () => {
    const address = watchAddressInput.trim();
    if (!isValidEvmAddress(address)) {
      setError(T("watch.addr_invalid"));
      return;
    }
    // Pass label unconditionally (even blank): on a re-add this lets the user
    // clear a previously-set label back to unnamed, not just rename it.
    const next = addWatchWallet(watchWallets, {
      chain: watchChainInput,
      address,
      label: watchLabelInput.trim(),
    });
    if (!next) {
      setError(T("watch.addr_invalid"));
      return;
    }
    const id = `${address.toLowerCase()}|${watchChainInput}`;
    const entry = next.find((w) => w.id === id);
    setWatchWallets(next);
    setError(null);
    setWatchAddressInput("");
    setWatchLabelInput("");
    setActiveWatchId(id);
    setPhase("watch");
    if (entry) void loadWatchView(entry);
  };

  const onOpenWatch = (w: WatchedWallet) => {
    setError(null);
    setActiveWatchId(w.id);
    setPhase("watch");
    void loadWatchView(w);
  };

  const onRemoveWatch = (id: string) => {
    const next = removeWatchWallet(watchWallets, id);
    setWatchWallets(next);
    if (id === activeWatchId) {
      setActiveWatchId(null);
      setBalances(null);
      setPhase("onboarding");
    }
  };

  const onExitWatch = () => {
    setActiveWatchId(null);
    setBalances(null);
    setBalancesError(null);
    setPrices({});
    setSparklineData([]);
    setPhase("onboarding");
  };

  const enter = useCallback(
    (next: Phase) => {
      setError(null);
      setPhase(next);
      if (next === "unlocked") void loadUnlockedView();
      else if (next === "onboarding" || next === "locked") void loadWalletMeta();
    },
    [loadUnlockedView, loadWalletMeta],
  );

  function resetSecrets() {
    setPassphrase("");
    setConfirmPass("");
    setSeedInput("");
    setRevealedSeed("");
    setBackedUp(false);
    setQuizQuestions([]);
    setQuizAnswers({});
    // Also drop the passphrase the unlock provider is holding for this session,
    // not just our local input state — otherwise it lingers for the lifetime of
    // the module singleton. Called only after a flow completes (never between a
    // create/import and its unlock), so no in-flight unlock loses its passphrase.
    getWalletApp().setPassphrase("");
  }

  const onCreate = () =>
    act(async () => {
      if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
      if (passphrase !== confirmPass) throw new Error("Passphrases do not match.");
      const app = getWalletApp();
      app.setPassphrase(passphrase);
      const { seedPhrase } = await app.engine.createWallet();
      setRevealedSeed(seedPhrase);
      enter("backup");
    });

  const onImport = () =>
    act(async () => {
      if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
      const phrase = seedInput.trim().replace(/\s+/g, " ");
      if (!phrase) throw new Error("Enter your seed phrase.");
      const app = getWalletApp();
      app.setPassphrase(passphrase);
      await app.engine.importWallet(phrase);
      await app.engine.unlock();
      resetSecrets();
      enter("unlocked");
    });

  const onConfirmBackup = () => {
    // Generate quiz questions instead of going straight to unlocked
    const questions = generateQuiz(revealedSeed);
    setQuizQuestions(questions);
    setQuizAnswers({});
    setError(null);
    setPhase("quiz");
  };

  const onQuizSubmit = () =>
    act(async () => {
      for (const q of quizQuestions) {
        if (quizAnswers[q.index] !== q.correct) {
          throw new Error(`Incorrect answer for word #${q.index + 1}. Please try again.`);
        }
      }
      await getWalletApp().engine.unlock();
      resetSecrets();
      addToast("success", T("toast.wallet_verified"));
      enter("unlocked");
    });

  const onSkipQuiz = () =>
    act(async () => {
      await getWalletApp().engine.unlock();
      resetSecrets();
      enter("unlocked");
    });

  const onUnlock = () =>
    act(async () => {
      if (!passphrase) throw new Error("Enter your passphrase.");
      const app = getWalletApp();
      app.setPassphrase(passphrase);
      await app.engine.unlock();
      resetSecrets();
      enter("unlocked");
    });

  const onLock = () =>
    act(async () => {
      await getWalletApp().engine.lock();
      clearSession();
      addToast("info", T("toast.locked"));
      enter("locked");
    });

  const onReview = () =>
    act(async () => {
      const list = balances ?? [];
      const asset = list.find((b) => assetKey(b.asset) === sendAssetKey)?.asset ?? list[0]?.asset;
      if (!asset) throw new Error("No sendable assets on configured chains.");
      const to = sendTo.trim();
      if (!to) throw new Error("Enter a recipient address.");
      const amount = parseUnits(sendAmount, asset.decimals);
      const intent: TxIntent = { asset, to, amount };
      const fee = await getWalletApp().engine.quoteSend(intent);
      setQuote({ intent, fee });
    });

  const onConfirmSend = () =>
    act(async () => {
      if (!quote) return;
      const res = await getWalletApp().engine.send(quote.intent);
      // Stamp a saved recipient as just-used so the address book can surface
      // recent payees first (no-op if the recipient isn't a saved contact).
      setContacts(touchContact(quote.intent.to, quote.intent.asset.chain));
      setLastSentRecipient(quote.intent.to);
      setLastSentChain(quote.intent.asset.chain);
      setIsContactSavedPostSend(false);
      setNewContactSendName("");
      setQuote(null);
      setSendTo("");
      setSendAmount("");
      setSentHash(res.hash);
      addToast("success", T("toast.sent"));
      await loadUnlockedView();
    });

  const onCancelQuote = () => {
    setError(null);
    setQuote(null);
  };

  const onSelectAccount = (index: number) =>
    act(async () => {
      await getWalletApp().engine.setActiveAccount(index);
      setActiveAccount(index);
      await loadUnlockedView();
    });

  const onAddAccount = () => {
    const next = accountCount;
    setAccountCount(next + 1);
    void onSelectAccount(next);
  };

  const onSelectWallet = (index: number) =>
    act(async () => {
      await getWalletApp().engine.setActiveWallet(index);
      setActiveWallet(index);
      clearSession();
      resetSecrets();
      enter("locked");
    });

  const onAddWallet = () =>
    act(async () => {
      const newIndex = await getWalletApp().engine.addWallet();
      setActiveWallet(newIndex);
      clearSession();
      resetSecrets();
      setMode("create");
      enter("onboarding");
    });

  const onEnrollPasskey = () =>
    act(async () => {
      await getWalletApp().enrollPasskey();
      setPasskeyAdded(true);
      addToast("success", T("toast.passkey_added"));
    });

  // ---- Max button handler ----
  const onMaxAmount = () => {
    if (!balances || balances.length === 0) return;
    const key = sendAssetKey || assetKey(balances[0]!.asset);
    const found = balances.find((b) => assetKey(b.asset) === key);
    if (found) {
      setSendAmount(formatUnits(found.amount, found.asset.decimals));
    }
  };

  // ---- Settings handlers ----
  const onOpenSettings = () => {
    setSettingsPassphrase("");
    setSettingsRevealedSeed(null);
    setPhase("settings");
  };

  const onBackFromSettings = () => {
    setSettingsPassphrase("");
    setSettingsRevealedSeed(null);
    enter("unlocked");
  };

  const onChangeAutolock = (min: number) => {
    setAutolockMin(min);
    localStorage.setItem(AUTO_LOCK_KEY, String(min));
  };

  const onVerifyRecovery = () =>
    act(async () => {
      if (!settingsPassphrase) throw new Error("Enter your passphrase.");
      // Re-authenticate without exposing seed material in the UI.
      const app = getWalletApp();
      app.setPassphrase(settingsPassphrase);
      await app.engine.unlock();
      setSettingsRevealedSeed(T("settings.recovery_success"));
      setSettingsPassphrase("");
    });



  const onRemoveContact = (address: string, chain: string) => {
    const updated = removeContact(address, chain);
    setContacts(updated);
    addToast("info", T("toast.contact_removed"));
  };

  const onToggleFavorite = (c: Contact) => {
    setContacts(updateContact(c.address, c.chain, { favorite: !c.favorite }));
  };

  const onStartEditContact = (c: Contact) => {
    setEditingContactKey(`${c.address}-${c.chain}`);
    setTemplatingContactKey(null);
    setEditContactName(c.name);
    setEditContactNote(c.note ?? "");
  };

  const onSaveEditContact = (c: Contact) => {
    if (!editContactName.trim()) {
      addToast("error", T("error.contact_required"));
      return;
    }
    // Empty note clears the field rather than persisting "".
    setContacts(updateContact(c.address, c.chain, {
      name: editContactName.trim(),
      note: editContactNote.trim() || undefined,
    }));
    setEditingContactKey(null);
    addToast("success", T("toast.contact_updated"));
  };

  // Assets that can be the target of a template, scoped to a contact's chain.
  const templatableAssets = useCallback(
    (chain: string) => DEFAULT_ASSETS.filter((a) => a.chain === chain),
    [],
  );

  const onStartTemplate = (c: Contact) => {
    const assets = templatableAssets(c.chain);
    setTemplatingContactKey(`${c.address}-${c.chain}`);
    setEditingContactKey(null);
    setNewTemplateName("");
    setNewTemplateAmount("");
    setNewTemplateAssetKey(assets[0] ? assetKey(assets[0]) : "");
  };

  const onSaveTemplate = (c: Contact) => {
    if (!newTemplateName.trim() || !newTemplateAssetKey) {
      addToast("error", T("error.contact_required"));
      return;
    }
    const tpl: PaymentTemplate = {
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newTemplateName.trim(),
      contactAddress: c.address,
      chain: c.chain,
      assetKey: newTemplateAssetKey,
      createdAt: Date.now(),
      ...(newTemplateAmount.trim() ? { amount: newTemplateAmount.trim() } : {}),
    };
    setTemplates(addTemplate(tpl));
    setTemplatingContactKey(null);
    addToast("success", T("toast.template_saved"));
  };

  const onRemoveTemplate = (id: string) => {
    setTemplates(removeTemplate(id));
    addToast("info", T("toast.template_removed"));
  };

  // Apply a template to the Send form: prefill recipient, asset and amount.
  const onApplyTemplate = (tpl: PaymentTemplate) => {
    setSendTo(tpl.contactAddress);
    setSendAssetKey(tpl.assetKey);
    setSendAmount(tpl.amount ?? "");
    addToast("info", T("send.template_applied"));
  };

  const onSaveDataSources = () => {
    const toList = (s: string) => s.split(/[\n,]/).map((u) => u.trim()).filter((u) => u.length > 0);
    const next: DataSources = {
      ethereumRpcUrls: toList(dsForm.ethereumRpcUrls),
      polygonRpcUrls: toList(dsForm.polygonRpcUrls),
      arbitrumRpcUrls: toList(dsForm.arbitrumRpcUrls),
      plasmaRpcUrls: toList(dsForm.plasmaRpcUrls),
      btcElectrumWsUrl: dsForm.btcElectrumWsUrl.trim(),
      indexerMode: dsForm.indexerMode,
      indexerUrl: dsForm.indexerUrl.trim(),
      pricesEnabled: dsForm.pricesEnabled,
      priceEndpoint: dsForm.priceEndpoint.trim(),
    };
    saveDataSources(next); // validates + drops malformed URLs before persisting
    // Rebuild the engine with the new chain options; the unlocked session is
    // discarded, so send the user back through unlock.
    resetWalletApp();
    clearSession();
    setPhase("locked");
    addToast("success", T("ds.saved_relock"));
  };

  // ---- Clipboard with toast ----
  const copyToClipboard = useCallback((value: string) => {
    void navigator.clipboard.writeText(value).then(() => {
      addToast("success", T("toast.copied"));
    });
  }, [addToast, T]);

  // ---- USD calculations ----
  const totalUsd = balances
    ? balances.reduce((sum, b) => {
        const price = prices[b.asset.symbol] ?? 0;
        const amount = Number(formatUnits(b.amount, b.asset.decimals));
        return sum + amount * price;
      }, 0)
    : 0;

  // ---- Animation variants ----
  const pageVariants = {
    initial: { opacity: 0, y: 15 },
    in: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
    out: { opacity: 0, y: -15, transition: { duration: 0.3 } }
  };

  const listVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.05 } }
  };

  const itemVariants = {
    hidden: { opacity: 0, x: -10 },
    show: { opacity: 1, x: 0 }
  };

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 py-8 font-sans sm:py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-50 drop-shadow-sm">{T("app.title")}</h1>
          <p className="mt-1 max-w-[16rem] text-xs leading-5 text-slate-300">{T("app.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Language toggle */}
          <button
            className="flex min-h-10 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-slate-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
            onClick={() => changeLocale(locale === "en" ? "ru" : "en")}
            title="Switch language"
          >
            <Globe size={10} />
            {locale.toUpperCase()}
          </button>
          <div className="flex min-h-10 items-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="pulse-indicator absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            </span>
            <span className="max-w-16 leading-3 sm:max-w-none sm:whitespace-nowrap">{T("app.worker")}</span>
          </div>
        </div>
      </header>

      {error && (
        <motion.p
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {error}
        </motion.p>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={phase}
          className="flex flex-col gap-6"
          variants={pageVariants}
          initial="initial"
          animate="in"
          exit="out"
        >

      {/* ---- Wallet switcher (show on onboarding/locked/unlocked) ---- */}
      {(phase === "onboarding" || phase === "locked" || phase === "unlocked") &&
        (walletCount >= 1 || activeWallet > 0) && (
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium text-lg">{T("wallets.title")}</h2>
              <button
                className="flex items-center gap-1.5 text-sm font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
                onClick={onAddWallet}
                disabled={busy}
              >
                <Plus size={16} />
                {T("wallets.new")}
              </button>
            </div>
            {editingWalletIndex === activeWallet ? (
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  className="flex-1 rounded-md border border-[--color-accent] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[--color-accent] text-white"
                  value={editWalletNameInput}
                  onChange={(e) => setEditWalletNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveWalletName();
                    else if (e.key === "Escape") cancelWalletRename();
                  }}
                  autoFocus
                />
                <button className="flex items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-3 text-emerald-400 hover:text-emerald-300 transition-colors" onClick={saveWalletName} aria-label={T("misc.save")} title={T("misc.save")}><Check size={14} /></button>
                <button className="flex items-center justify-center rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 px-3 text-red-400 hover:text-red-300 transition-colors" onClick={cancelWalletRename} aria-label={T("misc.cancel")} title={T("misc.cancel")}><X size={14} /></button>
              </div>
            ) : (
              <div className="flex gap-2 mb-2">
                <select
                  className="flex-1 rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                  aria-label={T("a11y.select_wallet")}
                  value={activeWallet}
                  onChange={(e) => onSelectWallet(Number(e.target.value))}
                  disabled={busy}
                >
                  {Array.from({ length: Math.max(walletCount, activeWallet + 1) }, (_, i) => (
                    <option key={i} value={i}>{walletNames[i] || `Wallet #${i}`}</option>
                  ))}
                </select>
                <button
                  className="flex items-center justify-center rounded-md border border-[--color-border] bg-white/5 hover:bg-white/10 px-3 text-[--color-muted] hover:text-white transition-colors"
                  onClick={() => renameWallet(activeWallet)}
                  aria-label="Rename this wallet"
                  title="Rename this wallet"
                ><Pencil size={14} /></button>
              </div>
            )}
            <p className="text-xs text-[--color-muted]">{T("wallets.hint")}</p>
          </Card>
        )}

      {phase === "loading" && <Card>{T("misc.loading")}</Card>}

      {/* ---- ONBOARDING ---- */}
      {phase === "onboarding" && (
        <Card>
          <div className="mb-4 flex gap-2 text-sm">
            <Tab active={mode === "create"} onClick={() => setMode("create")}>{T("onboard.create")}</Tab>
            <Tab active={mode === "import"} onClick={() => setMode("import")}>{T("onboard.import")}</Tab>
            <Tab active={mode === "watch"} onClick={() => setMode("watch")}>{T("onboard.watch")}</Tab>
          </div>

          {mode === "import" && (
            <Field label={T("onboard.seed_label")}>
              <textarea
                className="h-24 w-full resize-none rounded-md border border-[--color-border] bg-[--color-bg] p-3 text-sm break-anywhere outline-none focus:border-[--color-accent]"
                placeholder={T("onboard.seed_placeholder")}
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}

          {mode === "watch" ? (
            <>
              <p className="mb-3 text-sm text-[--color-muted]">{T("watch.onboard_hint")}</p>

              {watchWallets.length > 0 && (
                <div className="mb-4">
                  <div className="mb-1.5 text-[10px] uppercase tracking-wide text-[--color-muted]">{T("watch.existing")}</div>
                  <ul className="flex flex-col gap-1.5">
                    {watchWallets.map((w) => (
                      <li key={w.id}>
                        <button
                          className="flex w-full items-center gap-2 rounded-md border border-[--color-border] bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10 transition-colors"
                          onClick={() => onOpenWatch(w)}
                        >
                          <Eye size={14} className="shrink-0 text-amber-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-white">{w.label || w.address}</span>
                            <span className="block truncate text-[10px] text-[--color-muted]">{w.chain} · {w.address}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Field label={T("watch.chain_label")}>
                <select
                  className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                  value={watchChainInput}
                  onChange={(e) => setWatchChainInput(e.target.value as WatchChain)}
                >
                  {WATCH_CHAINS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label={T("watch.address_label")}>
                <Input type="text" value={watchAddressInput} onChange={setWatchAddressInput} placeholder="0x…" autoComplete="off" />
              </Field>
              <Field label={T("watch.label_label")}>
                <Input type="text" value={watchLabelInput} onChange={setWatchLabelInput} placeholder={T("watch.label_placeholder")} autoComplete="off" />
              </Field>
              <Button onClick={onStartWatch} busy={busy} workingLabel={T("misc.working")}>{T("watch.start")}</Button>
            </>
          ) : (
            <>
              <Field label={T("onboard.pass_label")}>
                <Input type="password" value={passphrase} onChange={setPassphrase} placeholder={T("onboard.pass_placeholder")} autoComplete="new-password" />
              </Field>

              {mode === "create" && (
                <Field label={T("onboard.confirm_label")}>
                  <Input type="password" value={confirmPass} onChange={setConfirmPass} placeholder={T("onboard.confirm_placeholder")} autoComplete="new-password" />
                </Field>
              )}

              <Button onClick={mode === "create" ? onCreate : onImport} busy={busy} workingLabel={T("misc.working")}>
                {mode === "create" ? T("onboard.btn_create") : T("onboard.btn_import")}
              </Button>
            </>
          )}
        </Card>
      )}

      {/* ---- BACKUP ---- */}
      {phase === "backup" && (
        <Card>
          <h2 className="mb-1 font-medium">{T("backup.title")}</h2>
          <p className="mb-3 text-sm text-[--color-muted]">{T("backup.desc")}</p>
          <pre className="mb-4 rounded-md border border-[--color-border] bg-[--color-bg] p-3 text-sm leading-relaxed break-anywhere whitespace-pre-wrap">
            {revealedSeed}
          </pre>
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={backedUp} onChange={(e) => setBackedUp(e.target.checked)} />
            {T("backup.checkbox")}
          </label>
          <Button onClick={onConfirmBackup} busy={busy} disabled={!backedUp} workingLabel={T("misc.working")}>
            {T("backup.continue")}
          </Button>
        </Card>
      )}

      {/* ---- SEED QUIZ ---- */}
      {phase === "quiz" && (
        <Card>
          <h2 className="mb-1 font-medium">{T("quiz.title")}</h2>
          <p className="mb-4 text-sm text-[--color-muted]">{T("quiz.desc")}</p>
          <div className="flex flex-col gap-4 mb-4">
            {quizQuestions.map((q) => (
              <div key={q.index}>
                <p className="text-sm font-medium mb-2 text-white">{T("quiz.word_n")}{q.index + 1}</p>
                <div className="grid grid-cols-2 gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      className={`rounded-md border px-3 py-2 text-sm transition-all ${
                        quizAnswers[q.index] === opt
                          ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                          : "border-[--color-border] bg-white/5 text-[--color-muted] hover:bg-white/10 hover:text-white"
                      }`}
                      onClick={() => setQuizAnswers((prev) => ({ ...prev, [q.index]: opt }))}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={onQuizSubmit}
              busy={busy}
              disabled={Object.keys(quizAnswers).length < quizQuestions.length}
              workingLabel={T("misc.working")}
            >
              {T("backup.continue")}
            </Button>
            <button
              className="rounded-md border border-[--color-border] px-4 py-2.5 text-sm text-[--color-muted] hover:text-white"
              onClick={onSkipQuiz}
              disabled={busy}
            >
              {T("misc.skip")}
            </button>
          </div>
        </Card>
      )}

      {/* ---- LOCKED ---- */}
      {phase === "locked" && (
        <Card>
          <h2 className="mb-3 font-medium">{T("lock.title")}</h2>
          <Field label={T("lock.pass_label")}>
            <Input type="password" value={passphrase} onChange={setPassphrase} placeholder={T("lock.pass_placeholder")} autoComplete="current-password" onEnter={onUnlock} />
          </Field>
          <Button onClick={onUnlock} busy={busy} workingLabel={T("misc.working")}>{T("lock.btn")}</Button>
        </Card>
      )}

      {/* ---- UNLOCKED ---- */}
      {phase === "unlocked" && (
        <>
          {/* Account card */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">{T("account.title")}</h2>
              <button className="text-sm text-[--color-muted] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50" onClick={onAddAccount} disabled={busy}>
                {T("account.add")}
              </button>
            </div>
            <select
              className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
              aria-label={T("a11y.select_account")}
              value={activeAccount}
              onChange={(e) => onSelectAccount(Number(e.target.value))}
              disabled={busy}
            >
              {Array.from({ length: accountCount }, (_, i) => (
                <option key={i} value={i}>{T("account.name_template")}{i}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-[--color-muted]">{T("account.hint")}</p>
          </Card>

          {/* Portfolio card */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium text-lg">{T("portfolio.title")}</h2>
              <div className="flex items-center gap-2">
                <button
                  className="flex items-center gap-1 text-sm text-[--color-muted] hover:text-white transition-colors"
                  onClick={onOpenSettings}
                  aria-label={T("settings.title")}
                  title={T("settings.title")}
                >
                  <Settings size={14} />
                </button>
                <button
                  className="flex items-center gap-1.5 text-sm text-[--color-muted] hover:text-white transition-colors"
                  onClick={onLock}
                  disabled={busy}
                >
                  <LogOut size={14} />
                  {T("portfolio.lock")}
                </button>
              </div>
            </div>

            {/* Total USD value */}
            {balances && balances.length > 0 && totalUsd > 0 && (
              <div className="mb-4 text-center">
                <p className="text-3xl font-bold text-white tracking-tight">{formatUsd(totalUsd)}</p>
                <p className="text-xs text-[--color-muted] mt-1">{T("portfolio.total")}</p>
              </div>
            )}

            {balances === null && !balancesError && (
              <div className="flex flex-col gap-3 mt-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}
            {balancesError && (
              <div className="text-sm">
                <p className="mb-2 text-red-300">{balancesError}</p>
                <button className="text-[--color-accent] underline-offset-2 hover:underline" onClick={() => void loadUnlockedView()}>{T("misc.retry")}</button>
              </div>
            )}
            {balances && balances.length === 0 && (
              <div className="text-center py-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                  <ArrowDownRight size={24} />
                </div>
                <p className="text-sm text-[--color-muted] mb-2">{T("empty.portfolio")}</p>
                <button className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors" onClick={() => document.getElementById("receive-section")?.scrollIntoView({ behavior: "smooth" })}>
                  {T("empty.portfolio_cta")}
                </button>
              </div>
            )}
            {balances && balances.length > 0 && (
              <>
                <motion.ul variants={listVariants} initial="hidden" animate="show" className="divide-y divide-[--color-border]">
                  {balances.map((b) => {
                    const price = prices[b.asset.symbol] ?? 0;
                    const amount = Number(formatUnits(b.amount, b.asset.decimals));
                    const usdValue = amount * price;
                    return (
                      <motion.li
                        variants={itemVariants}
                        key={`${b.asset.symbol}-${b.asset.chain}`}
                        className="flex items-center justify-between py-2.5 text-sm transition-colors hover:bg-white/[0.02] px-1 rounded"
                      >
                        <span>
                          <span className="font-semibold text-white">{b.asset.symbol}</span>{" "}
                          <span className="text-[--color-muted] text-xs">{T("misc.on")} {b.asset.chain}</span>
                        </span>
                        <span className="text-right">
                          <span className="font-mono text-emerald-400 font-medium block">
                            {formatUnits(b.amount, b.asset.decimals)}
                          </span>
                          {price > 0 && (
                            <span className="text-[10px] text-[--color-muted]">{formatUsd(usdValue)}</span>
                          )}
                        </span>
                      </motion.li>
                    );
                  })}
                </motion.ul>
                {/* Sparkline chart */}
                {sparklineData.length > 0 && <Sparkline data={sparklineData} />}
              </>
            )}
          </Card>

          {/* Send card */}
          <Card>
            <h2 className="mb-3 font-medium">{T("send.title")}</h2>

            {(!balances || balances.length === 0) && (
              <p className="text-sm text-[--color-muted]">{T("send.no_assets")}</p>
            )}

            {balances && balances.length > 0 && !quote && sentHash === null && (
              <>
                <Field label={T("send.asset")}>
                  <select
                    className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                    value={sendAssetKey || assetKey(balances[0]!.asset)}
                    onChange={(e) => setSendAssetKey(e.target.value)}
                  >
                    {balances.map((b) => (
                      <option key={assetKey(b.asset)} value={assetKey(b.asset)}>
                        {b.asset.symbol} {T("misc.on")} {b.asset.chain}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={T("send.recipient")}>
                  <Input type="text" value={sendTo} onChange={setSendTo} placeholder={T("send.recipient_placeholder")} autoComplete="off" />
                </Field>

                {/* Contacts — favorites first (state is kept sorted) */}
                {contacts.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {contacts.map((c) => (
                      <button
                        key={`${c.address}-${c.chain}`}
                        className="contact-chip"
                        onClick={() => { setSendTo(c.address); }}
                        title={c.address}
                      >
                        {c.favorite ? <Star size={10} className="fill-current text-amber-400" /> : <BookUser size={10} />}
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Payment templates — one tap prefills recipient + asset + amount */}
                {templates.length > 0 && (
                  <div className="mb-3">
                    <div className="mb-1.5 text-[10px] uppercase tracking-wide text-[--color-muted]">{T("send.templates")}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          className="contact-chip"
                          onClick={() => onApplyTemplate(tpl)}
                          title={`${tpl.assetKey}${tpl.amount ? ` · ${tpl.amount}` : ""}`}
                        >
                          <FileText size={10} />
                          {tpl.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <QrScanner onResult={setSendTo} label={T("misc.scan_qr")} closeLabel={T("misc.close")} cancelLabel={T("misc.cancel")} />

                <Field label={T("send.amount")}>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input type="text" value={sendAmount} onChange={setSendAmount} placeholder="0.0" autoComplete="off" />
                    </div>
                    <button
                      className="shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors"
                      onClick={onMaxAmount}
                      title={T("send.max")}
                    >
                      MAX
                    </button>
                  </div>
                </Field>
                <Button onClick={onReview} busy={busy} workingLabel={T("misc.working")}>{T("send.review")}</Button>
              </>
            )}

            {quote && (
              <div className="text-sm">
                <p className="mb-3 text-[--color-muted]">{T("send.confirm_hint")}</p>
                <dl className="mb-4 divide-y divide-[--color-border] rounded-md border border-[--color-border]">
                  <Row k={T("misc.amount")} v={`${formatUnits(quote.intent.amount, quote.intent.asset.decimals)} ${quote.intent.asset.symbol}`} />
                  <Row k={T("misc.asset")} v={quote.intent.asset.token ? `${quote.intent.asset.symbol} (${quote.intent.asset.token})` : quote.intent.asset.symbol} />
                  <Row k={T("misc.chain")} v={quote.intent.asset.chain} />
                  <Row k={T("misc.recipient")} v={quote.intent.to} mono />
                  <Row k={T("misc.network_fee")} v={`${formatUnits(quote.fee.fee, quote.fee.feeAsset.decimals)} ${quote.fee.feeAsset.symbol}`} />
                </dl>
                <SafetyPanel
                  asset={quote.intent.asset}
                  to={quote.intent.to}
                  contacts={contacts}
                  ownAddresses={addresses}
                  recentRecipient={lastSentRecipient}
                  recentChain={lastSentChain}
                  T={T}
                />
                <div className="flex gap-2">
                  <Button onClick={onConfirmSend} busy={busy} workingLabel={T("misc.working")}>{T("send.confirm_btn")}</Button>
                  <button className="rounded-md border border-[--color-border] px-4 py-2.5 text-sm text-[--color-muted] hover:text-white disabled:cursor-not-allowed disabled:opacity-50" onClick={onCancelQuote} disabled={busy}>{T("send.cancel")}</button>
                </div>
              </div>
            )}

            {sentHash !== null && (
              <div className="text-sm">
                <p className="mb-2 text-green-300">{T("send.broadcast")}</p>
                <a
                  href={explorerUrl(
                    lastSentChain || "bitcoin",
                    sentHash,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors mb-2"
                >
                  <ExternalLink size={12} />
                  {T("misc.view_explorer")}
                </a>
                <code className="block break-anywhere rounded-md border border-[--color-border] bg-[--color-bg] p-2 text-xs">
                  {sentHash}
                </code>

                {/* Post-send inline save contact form */}
                {lastSentRecipient &&
                 !contacts.some(c => c.address.toLowerCase() === lastSentRecipient.toLowerCase() && c.chain === lastSentChain) &&
                 !isContactSavedPostSend && (
                  <div className="glass-card rounded-xl p-4 mt-4 flex flex-col gap-3 border border-emerald-500/20 bg-emerald-500/5">
                    <span className="text-sm font-medium text-white">{T("send.save_contact_prompt")}</span>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        placeholder={T("settings.contacts_name")}
                        value={newContactSendName}
                        onChange={(e) => setNewContactSendName(e.target.value)}
                      />
                      <button
                        className="bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-black font-semibold text-xs px-4 py-2 rounded-lg transition-colors flex items-center shrink-0"
                        onClick={() => {
                          if (newContactSendName.trim()) {
                            const updated = addContact({
                              name: newContactSendName.trim(),
                              address: lastSentRecipient,
                              chain: lastSentChain
                            });
                            setContacts(updated);
                            setIsContactSavedPostSend(true);
                            addToast("success", T("toast.contact_saved"));
                          }
                        }}
                      >
                        {T("send.save_contact")}
                      </button>
                    </div>
                  </div>
                )}

                <button className="mt-3 text-[--color-accent] underline-offset-2 hover:underline" onClick={() => setSentHash(null)}>
                  {T("send.another")}
                </button>
              </div>
            )}
          </Card>

          {/* Receive card */}
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-medium" id="receive-section">{T("receive.title")}</h2>
              <div className="flex gap-1.5">
                <Tab active={receiveMode === "address"} onClick={() => setReceiveMode("address")}>{T("receive.mode_address")}</Tab>
                <Tab active={receiveMode === "request"} onClick={() => setReceiveMode("request")}>{T("receive.mode_request")}</Tab>
              </div>
            </div>
            {addresses.length === 0 && (
              <p className="text-sm text-[--color-muted]">{T("receive.no_addr")}</p>
            )}
            {receiveMode === "address" ? (
              <ul className="flex flex-col gap-3">
                {addresses.map(([chain, addr]) => (
                  <li key={chain}>
                    <div className="mb-1 text-xs uppercase tracking-wide text-[--color-muted]">{chain}</div>
                    <div className="flex items-start gap-2">
                      <code className="flex-1 rounded-md border border-[--color-border] bg-[--color-bg] p-2 text-xs break-anywhere">
                        {addr}
                      </code>
                      <button
                        className="shrink-0 rounded-md border border-[--color-border] px-2 py-2 text-xs text-[--color-muted] hover:text-white"
                        onClick={() => copyToClipboard(addr)}
                        aria-label={`Copy ${chain} receive address`}
                        title={`Copy ${chain} receive address`}
                      >
                        <CopyIcon size={14} />
                      </button>
                    </div>
                    <Qr value={addr} chain={chain} />
                  </li>
                ))}
              </ul>
            ) : (
              <ReceiveRequest
                balances={balances}
                addresses={addresses}
                copyToClipboard={copyToClipboard}
                T={T}
              />
            )}
          </Card>

          {/* Activity card */}
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">{T("activity.title")}</h2>
              <button className="text-sm text-[--color-muted] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void loadActivity()} disabled={busy}>
                {T("activity.refresh")}
              </button>
            </div>

            {activity === null && !activityError && (
              <div className="flex flex-col gap-3 mt-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}
            {activityError && <p className="text-sm text-red-300">{activityError}</p>}
            {activity && activity.length === 0 && (
              <div className="text-center py-6">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
                  <ArrowUpRight size={24} />
                </div>
                <p className="text-sm text-[--color-muted]">{T("activity.empty")}</p>
              </div>
            )}
            {activity && activity.length > 0 && (
              <motion.ul variants={listVariants} initial="hidden" animate="show" className="divide-y divide-[--color-border]">
                {activity.map((it) => (
                  <motion.li
                    variants={itemVariants}
                    key={it.hash}
                    className="flex items-center justify-between gap-3 py-3 text-sm transition-colors hover:bg-white/[0.02] px-1 rounded"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${it.direction === "out" ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                        {it.direction === "out" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                      </div>
                      <span>
                        <span className="font-medium">
                          {it.direction === "out" ? "−" : "+"}
                          {formatUnits(it.amount, it.asset.decimals)} {it.asset.symbol}
                        </span>{" "}
                        <span className="text-[--color-muted]">{T("misc.on")} {it.asset.chain}</span>
                        <span className="block text-xs text-[--color-muted]">
                          {new Date(it.timestamp).toLocaleString()}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={explorerUrl(it.asset.chain, it.hash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[--color-muted] hover:text-white transition-colors"
                        aria-label={T("misc.view_explorer")}
                        title={T("misc.view_explorer")}
                      >
                        <ExternalLink size={12} />
                      </a>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium flex items-center gap-1.5 ${statusClass(it.status)}`}>
                        {it.status === "pending" && <Loader2 size={12} className="animate-spin" />}
                        {it.status}
                      </span>
                    </div>
                  </motion.li>
                ))}
              </motion.ul>
            )}

            <p className="mt-3 text-xs text-[--color-muted]">{T("activity.hint")}</p>
          </Card>

          {/* Security card */}
          {webauthnOk && (
            <Card>
              <h2 className="mb-1 font-medium">{T("security.title")}</h2>
              {passkeyAdded ? (
                <p className="text-sm text-green-300">{T("security.passkey_added")}</p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-[--color-muted]">{T("security.passkey_desc")}</p>
                  <Button onClick={onEnrollPasskey} busy={busy} workingLabel={T("misc.working")}>{T("security.add_passkey")}</Button>
                </>
              )}
            </Card>
          )}
        </>
      )}

      {/* ---- WATCH-ONLY ---- */}
      {phase === "watch" && activeWatch && (
        <>
          {/* Watch-only badge + switcher */}
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-medium text-lg">
                <span className="flex h-6 items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 text-xs font-medium text-amber-300">
                  <Eye size={12} />{T("watch.badge")}
                </span>
              </h2>
              <button
                className="flex items-center gap-1.5 text-sm text-[--color-muted] hover:text-white transition-colors"
                onClick={onExitWatch}
              >
                <LogOut size={14} />
                {T("watch.exit")}
              </button>
            </div>

            {watchWallets.length > 1 && (
              <select
                className="mb-3 w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                aria-label={T("a11y.select_watch")}
                value={activeWatch.id}
                onChange={(e) => {
                  const w = watchWallets.find((x) => x.id === e.target.value);
                  if (w) onOpenWatch(w);
                }}
              >
                {watchWallets.map((w) => (
                  <option key={w.id} value={w.id}>{w.label || w.address} · {w.chain}</option>
                ))}
              </select>
            )}

            <div className="mb-1 text-xs uppercase tracking-wide text-[--color-muted]">{activeWatch.chain}</div>
            <div className="flex items-start gap-2">
              <code className="flex-1 rounded-md border border-[--color-border] bg-[--color-bg] p-2 text-xs break-anywhere">
                {activeWatch.address}
              </code>
              <button
                className="shrink-0 rounded-md border border-[--color-border] px-2 py-2 text-xs text-[--color-muted] hover:text-white"
                onClick={() => copyToClipboard(activeWatch.address)}
                aria-label={T("watch.copy_addr")}
                title={T("watch.copy_addr")}
              >
                <CopyIcon size={14} />
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                className="flex items-center gap-1.5 rounded-md border border-[--color-border] bg-white/5 px-3 py-2 text-xs text-[--color-muted] hover:text-white transition-colors"
                onClick={() => { setMode("watch"); setPhase("onboarding"); }}
              >
                <Plus size={14} />{T("watch.add_another")}
              </button>
              <button
                className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 hover:bg-red-500/20 transition-colors"
                onClick={() => onRemoveWatch(activeWatch.id)}
              >
                <Trash2 size={14} />{T("watch.remove")}
              </button>
            </div>
          </Card>

          {/* Portfolio card (read-only) */}
          <Card>
            <h2 className="mb-3 font-medium text-lg">{T("portfolio.title")}</h2>

            {balances && balances.length > 0 && totalUsd > 0 && (
              <div className="mb-4 text-center">
                <p className="text-3xl font-bold text-white tracking-tight">{formatUsd(totalUsd)}</p>
                <p className="text-xs text-[--color-muted] mt-1">{T("portfolio.total")}</p>
              </div>
            )}

            {balances === null && !balancesError && (
              <div className="flex flex-col gap-3 mt-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            )}
            {balancesError && (
              <div className="text-sm">
                <p className="mb-2 text-red-300">{balancesError}</p>
                <button className="text-[--color-accent] underline-offset-2 hover:underline" onClick={() => void loadWatchView(activeWatch)}>{T("misc.retry")}</button>
              </div>
            )}
            {balances && balances.length === 0 && (
              <p className="py-6 text-center text-sm text-[--color-muted]">{T("watch.empty")}</p>
            )}
            {balances && balances.length > 0 && (
              <>
                <motion.ul variants={listVariants} initial="hidden" animate="show" className="divide-y divide-[--color-border]">
                  {balances.map((b) => {
                    const price = prices[b.asset.symbol] ?? 0;
                    const amount = Number(formatUnits(b.amount, b.asset.decimals));
                    const usdValue = amount * price;
                    return (
                      <motion.li
                        variants={itemVariants}
                        key={`${b.asset.symbol}-${b.asset.chain}`}
                        className="flex items-center justify-between py-2.5 text-sm transition-colors hover:bg-white/[0.02] px-1 rounded"
                      >
                        <span>
                          <span className="font-semibold text-white">{b.asset.symbol}</span>{" "}
                          <span className="text-[--color-muted] text-xs">{T("misc.on")} {b.asset.chain}</span>
                        </span>
                        <span className="text-right">
                          <span className="font-mono text-emerald-400 font-medium block">
                            {formatUnits(b.amount, b.asset.decimals)}
                          </span>
                          {price > 0 && (
                            <span className="text-[10px] text-[--color-muted]">{formatUsd(usdValue)}</span>
                          )}
                        </span>
                      </motion.li>
                    );
                  })}
                </motion.ul>
                {sparklineData.length > 0 && <Sparkline data={sparklineData} />}
              </>
            )}
          </Card>

          {/* Send is disabled for watch-only */}
          <Card>
            <h2 className="mb-2 font-medium">{T("send.title")}</h2>
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-200">
              <Info size={16} className="mt-0.5 shrink-0" />
              <span>{T("watch.cannot_sign")}</span>
            </div>
          </Card>

          {/* Receive card — the watched address + QR */}
          <Card>
            <h2 className="mb-3 font-medium">{T("receive.title")}</h2>
            <div className="mb-1 text-xs uppercase tracking-wide text-[--color-muted]">{activeWatch.chain}</div>
            <div className="flex items-start gap-2">
              <code className="flex-1 rounded-md border border-[--color-border] bg-[--color-bg] p-2 text-xs break-anywhere">
                {activeWatch.address}
              </code>
              <button
                className="shrink-0 rounded-md border border-[--color-border] px-2 py-2 text-xs text-[--color-muted] hover:text-white"
                onClick={() => copyToClipboard(activeWatch.address)}
                aria-label={T("watch.copy_addr")}
                title={T("watch.copy_addr")}
              >
                <CopyIcon size={14} />
              </button>
            </div>
            <Qr value={activeWatch.address} chain={activeWatch.chain} />
          </Card>
        </>
      )}

      {/* ---- SETTINGS ---- */}
      {phase === "settings" && (
        <>
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium text-lg">{T("settings.title")}</h2>
              <button className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors" onClick={onBackFromSettings}>
                {T("settings.back")}
              </button>
            </div>

            {/* Auto-Lock Timer */}
            <div className="settings-row">
              <div className="flex items-center gap-2">
                <Timer size={16} className="text-[--color-muted]" />
                <div>
                  <p className="text-sm font-medium">{T("settings.autolock")}</p>
                  <p className="text-xs text-[--color-muted]">{T("settings.autolock_desc")}</p>
                </div>
              </div>
              <select
                className="rounded-md border border-[--color-border] bg-[--color-bg] px-2 py-1 text-sm outline-none"
                aria-label={T("settings.autolock")}
                value={autolockMin}
                onChange={(e) => onChangeAutolock(Number(e.target.value))}
              >
                {[1, 2, 5, 15, 30].map((m) => (
                  <option key={m} value={m}>{m} {T("settings.minutes")}</option>
                ))}
              </select>
            </div>

            {/* Language */}
            <div className="settings-row">
              <div className="flex items-center gap-2">
                <Globe size={16} className="text-[--color-muted]" />
                <p className="text-sm font-medium">{T("settings.language")}</p>
              </div>
              <select
                className="rounded-md border border-[--color-border] bg-[--color-bg] px-2 py-1 text-sm outline-none"
                aria-label={T("settings.language")}
                value={locale}
                onChange={(e) => changeLocale(e.target.value as Locale)}
              >
                <option value="en">English</option>
                <option value="ru">Русский</option>
              </select>
            </div>
          </Card>

          {/* Recovery Check */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={16} className="text-amber-400" />
              <h2 className="font-medium">{T("settings.reveal")}</h2>
            </div>
            <p className="text-sm text-[--color-muted] mb-3">{T("settings.reveal_desc")}</p>
            {settingsRevealedSeed ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                  <p className="text-sm leading-relaxed text-emerald-100">
                  {settingsRevealedSeed}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <Field label={T("lock.pass_label")}>
                  <Input type="password" value={settingsPassphrase} onChange={setSettingsPassphrase} placeholder={T("lock.pass_placeholder")} autoComplete="current-password" />
                </Field>
                <Button onClick={onVerifyRecovery} busy={busy} workingLabel={T("misc.working")}>{T("settings.reveal_btn")}</Button>
              </>
            )}
          </Card>

          {/* Address Book */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <BookUser size={16} className="text-[--color-muted]" />
              <h2 className="font-medium">{T("settings.contacts_title")}</h2>
            </div>
            {contacts.length === 0 ? (
              <p className="text-sm text-[--color-muted]">{T("settings.contacts_empty")}</p>
            ) : (
              <ul className="divide-y divide-[--color-border]">
                {contacts.map((c) => {
                  const key = `${c.address}-${c.chain}`;
                  const tplAssets = templatableAssets(c.chain);
                  return (
                  <li key={key} className="py-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="flex items-center gap-1.5 font-medium text-white">
                          {c.favorite && <Star size={12} className="shrink-0 fill-current text-amber-400" />}
                          {c.name}
                        </span>
                        <span className="block text-xs text-[--color-muted] break-anywhere">{c.address}</span>
                        <span className="text-[10px] text-[--color-muted] uppercase">{c.chain}</span>
                        {c.note && <span className="block text-xs text-[--color-muted] italic">{c.note}</span>}
                        {c.lastUsedAt && (
                          <span className="block text-[10px] text-[--color-muted]">
                            {T("settings.contacts_last_used")}: {new Date(c.lastUsedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          className={`p-1 transition-colors ${c.favorite ? "text-amber-400 hover:text-amber-300" : "text-[--color-muted] hover:text-white"}`}
                          onClick={() => onToggleFavorite(c)}
                          aria-label={c.favorite ? T("settings.contacts_unfavorite") : T("settings.contacts_favorite")}
                          title={c.favorite ? T("settings.contacts_unfavorite") : T("settings.contacts_favorite")}
                        >
                          <Star size={14} className={c.favorite ? "fill-current" : ""} />
                        </button>
                        <button
                          className="p-1 text-[--color-muted] hover:text-white transition-colors"
                          onClick={() => onStartEditContact(c)}
                          aria-label={T("settings.contacts_edit")}
                          title={T("settings.contacts_edit")}
                        >
                          <Pencil size={14} />
                        </button>
                        {tplAssets.length > 0 && (
                          <button
                            className="p-1 text-[--color-muted] hover:text-white transition-colors"
                            onClick={() => onStartTemplate(c)}
                            aria-label={T("settings.contacts_save_template")}
                            title={T("settings.contacts_save_template")}
                          >
                            <FileText size={14} />
                          </button>
                        )}
                        <button
                          className="p-1 text-red-400 hover:text-red-300 transition-colors"
                          onClick={() => onRemoveContact(c.address, c.chain)}
                          aria-label={T("misc.remove")}
                          title={T("misc.remove")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {editingContactKey === key && (
                      <div className="glass-card rounded-xl p-3 mt-2 flex flex-col gap-2 border border-emerald-500/20 bg-emerald-500/5">
                        <input
                          type="text"
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder={T("settings.contacts_name")}
                          value={editContactName}
                          onChange={(e) => setEditContactName(e.target.value)}
                        />
                        <input
                          type="text"
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder={T("settings.contacts_note_ph")}
                          value={editContactNote}
                          onChange={(e) => setEditContactNote(e.target.value)}
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            className="rounded-md border border-[--color-border] px-3 py-1.5 text-xs text-[--color-muted] hover:text-white transition-colors"
                            onClick={() => setEditingContactKey(null)}
                          >
                            {T("misc.cancel")}
                          </button>
                          <button
                            className="bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-black font-semibold text-xs px-4 py-1.5 rounded-lg transition-colors"
                            onClick={() => onSaveEditContact(c)}
                          >
                            {T("misc.save")}
                          </button>
                        </div>
                      </div>
                    )}

                    {templatingContactKey === key && (
                      <div className="glass-card rounded-xl p-3 mt-2 flex flex-col gap-2 border border-emerald-500/20 bg-emerald-500/5">
                        <span className="text-xs font-medium text-white">{T("settings.tpl_title")}</span>
                        <input
                          type="text"
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder={T("settings.tpl_name_ph")}
                          value={newTemplateName}
                          onChange={(e) => setNewTemplateName(e.target.value)}
                        />
                        <select
                          className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                          value={newTemplateAssetKey}
                          onChange={(e) => setNewTemplateAssetKey(e.target.value)}
                          aria-label={T("settings.tpl_asset")}
                        >
                          {tplAssets.map((a) => (
                            <option key={assetKey(a)} value={assetKey(a)}>{a.symbol}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                          placeholder={T("settings.tpl_amount")}
                          value={newTemplateAmount}
                          onChange={(e) => setNewTemplateAmount(e.target.value)}
                        />
                        <div className="flex gap-2 justify-end">
                          <button
                            className="rounded-md border border-[--color-border] px-3 py-1.5 text-xs text-[--color-muted] hover:text-white transition-colors"
                            onClick={() => setTemplatingContactKey(null)}
                          >
                            {T("misc.cancel")}
                          </button>
                          <button
                            className="bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-black font-semibold text-xs px-4 py-1.5 rounded-lg transition-colors"
                            onClick={() => onSaveTemplate(c)}
                          >
                            {T("settings.tpl_save")}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}

            {templates.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 border-t border-[--color-border] pt-3">
                  {templates.map((tpl) => (
                    <li key={tpl.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 text-[--color-muted]">
                        <FileText size={12} className="shrink-0" />
                        <span className="truncate text-white">{tpl.name}</span>
                        <span className="shrink-0">· {tpl.assetKey}{tpl.amount ? ` · ${tpl.amount}` : ""}</span>
                      </span>
                      <button
                        className="shrink-0 p-1 text-red-400 hover:text-red-300 transition-colors"
                        onClick={() => onRemoveTemplate(tpl.id)}
                        aria-label={T("misc.remove")}
                        title={T("misc.remove")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

            {isAddingContact ? (
              <div className="glass-card rounded-xl p-4 mt-3 flex flex-col gap-3 border border-emerald-500/20 bg-emerald-500/5">
                <span className="text-sm font-medium text-white">{T("settings.contacts_add_title")}</span>
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder={T("settings.contacts_name")}
                    value={newContactName}
                    onChange={(e) => setNewContactName(e.target.value)}
                  />
                  <input
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder={T("settings.contacts_address")}
                    value={newContactAddress}
                    onChange={(e) => setNewContactAddress(e.target.value)}
                  />
                  <input
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder={T("settings.contacts_note_ph")}
                    value={newContactNote}
                    onChange={(e) => setNewContactNote(e.target.value)}
                  />
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase text-[--color-muted]">{T("settings.contacts_chain")}</label>
                    <select
                      className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                      aria-label={T("settings.contacts_chain")}
                      value={newContactChain}
                      onChange={(e) => setNewContactChain(e.target.value)}
                    >
                      <option value="ethereum">Ethereum</option>
                      <option value="bitcoin">Bitcoin</option>
                      <option value="polygon">Polygon</option>
                      <option value="arbitrum">Arbitrum</option>
                      <option value="plasma">Plasma</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    className="rounded-md border border-[--color-border] px-3 py-1.5 text-xs text-[--color-muted] hover:text-white transition-colors"
                    onClick={() => {
                      setIsAddingContact(false);
                      setNewContactName("");
                      setNewContactAddress("");
                      setNewContactNote("");
                    }}
                  >
                    {T("misc.cancel")}
                  </button>
                  <button
                    className="bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-black font-semibold text-xs px-4 py-1.5 rounded-lg transition-colors"
                    onClick={() => {
                      if (!newContactName.trim() || !newContactAddress.trim()) {
                        addToast("error", T("error.contact_required"));
                        return;
                      }
                      const updated = addContact({
                        name: newContactName.trim(),
                        address: newContactAddress.trim(),
                        chain: newContactChain.trim(),
                        ...(newContactNote.trim() ? { note: newContactNote.trim() } : {}),
                      });
                      setContacts(updated);
                      setIsAddingContact(false);
                      setNewContactName("");
                      setNewContactAddress("");
                      setNewContactNote("");
                      addToast("success", T("toast.contact_saved"));
                    }}
                  >
                    {T("settings.contacts_add")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="mt-3 flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                onClick={() => setIsAddingContact(true)}
              >
                <UserPlus size={14} />
                {T("settings.contacts_add")}
              </button>
            )}
          </Card>

          {/* Data Sources & Privacy */}
          <Card>
            <div className="flex items-center gap-2 mb-2">
              <Globe size={16} className="text-[--color-muted]" />
              <h2 className="font-medium">{T("ds.title")}</h2>
            </div>
            <p className="mb-3 text-xs text-[--color-muted]">{T("ds.intro")}</p>

            <div className="flex flex-col gap-3">
              {([
                ["ds.rpc_eth", "ethereumRpcUrls"],
                ["ds.rpc_polygon", "polygonRpcUrls"],
                ["ds.rpc_arbitrum", "arbitrumRpcUrls"],
                ["ds.rpc_plasma", "plasmaRpcUrls"],
              ] as const).map(([label, key]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-xs text-[--color-muted]">{T(label)}</span>
                  <textarea
                    rows={2}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors break-anywhere"
                    placeholder={T("ds.rpc_ph")}
                    value={dsForm[key]}
                    onChange={(e) => setDsForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </label>
              ))}

              <label className="block">
                <span className="mb-1 block text-xs text-[--color-muted]">{T("ds.btc_ws")}</span>
                <input
                  type="text"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder={T("ds.btc_ws_ph")}
                  value={dsForm.btcElectrumWsUrl}
                  onChange={(e) => setDsForm((f) => ({ ...f, btcElectrumWsUrl: e.target.value }))}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs text-[--color-muted]">{T("ds.indexer_mode")}</span>
                <select
                  className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
                  value={dsForm.indexerMode}
                  onChange={(e) => setDsForm((f) => ({ ...f, indexerMode: e.target.value as IndexerMode }))}
                >
                  <option value="local">{T("ds.indexer_local")}</option>
                  <option value="indexer">{T("ds.indexer_remote")}</option>
                </select>
              </label>

              {dsForm.indexerMode === "indexer" && (
                <label className="block">
                  <span className="mb-1 block text-xs text-[--color-muted]">{T("ds.indexer_url")}</span>
                  <input
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="https://…"
                    value={dsForm.indexerUrl}
                    onChange={(e) => setDsForm((f) => ({ ...f, indexerUrl: e.target.value }))}
                  />
                </label>
              )}

              <label className="flex items-center gap-2 text-sm text-white">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-500"
                  checked={dsForm.pricesEnabled}
                  onChange={(e) => setDsForm((f) => ({ ...f, pricesEnabled: e.target.checked }))}
                />
                {T("ds.prices_enabled")}
              </label>

              {dsForm.pricesEnabled && (
                <label className="block">
                  <span className="mb-1 block text-xs text-[--color-muted]">{T("ds.price_endpoint")}</span>
                  <input
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder={T("ds.price_endpoint_ph")}
                    value={dsForm.priceEndpoint}
                    onChange={(e) => setDsForm((f) => ({ ...f, priceEndpoint: e.target.value }))}
                  />
                </label>
              )}

              <ul className="flex flex-col gap-1 rounded-md border border-[--color-border] bg-[--color-bg] p-3 text-[11px] text-[--color-muted]">
                <li>· {T("ds.priv_rpc")}</li>
                <li>· {T("ds.priv_local")}</li>
                <li>· {T("ds.priv_prices")}</li>
                <li>· {T("ds.priv_indexer")}</li>
              </ul>

              <Button onClick={onSaveDataSources}>{T("ds.save")}</Button>
            </div>
          </Card>

          {/* Delete Wallet */}
          <Card>
            <div className="flex items-center gap-2 mb-3">
              <Trash2 size={16} className="text-red-400" />
              <h2 className="font-medium text-red-400">{T("settings.delete")}</h2>
            </div>
            <p className="text-sm text-[--color-muted] mb-3">{T("settings.delete_desc")}</p>
            {confirmDeleteWallet ? (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 mb-3 text-sm">
                <p className="text-red-300 font-medium mb-3">{T("settings.delete_confirm")}</p>
                <div className="flex gap-2">
                  <button
                    className="bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold text-xs px-4 py-2 rounded-lg transition-colors animate-pulse"
                    onClick={() => {
                      const req = indexedDB.deleteDatabase("wdk-wallet");
                      req.onsuccess = () => {
                        LOCAL_STORAGE_KEYS_ON_WALLET_DELETE.forEach((key) => localStorage.removeItem(key));
                        clearSession();
                        setConfirmDeleteWallet(false);
                        addToast("success", T("toast.wallet_deleted"));
                        setTimeout(() => {
                          window.location.reload();
                        }, 1200);
                      };
                      req.onerror = () => {
                        addToast("error", T("error.delete_failed"));
                      };
                    }}
                  >
                    {T("settings.delete_btn")}
                  </button>
                  <button
                    className="rounded-md border border-[--color-border] px-3 py-1.5 text-xs text-[--color-muted] hover:text-white transition-colors"
                    onClick={() => setConfirmDeleteWallet(false)}
                  >
                    {T("misc.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold text-xs px-4 py-2 rounded-lg transition-colors border border-red-500/20"
                onClick={() => setConfirmDeleteWallet(true)}
              >
                {T("settings.delete")}
              </button>
            )}
          </Card>
        </>
      )}
        </motion.div>
      </AnimatePresence>

      {/* ---- Toast container ---- */}
      <div className="toast-container">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className={`toast toast-${toast.type}`}
            >
              {toast.type === "success" && <CheckCircle2 size={16} />}
              {toast.type === "error" && <XCircle size={16} />}
              {toast.type === "info" && <Info size={16} />}
              {toast.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </main>
  );
}

/* ---- Sparkline ---- */
function Sparkline({ data }: { readonly data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 40;
  const w = 200;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });
  const path = `M${points.join(" L")}`;
  const area = `${path} L${w},${h} L0,${h} Z`;
  const change = ((data[data.length - 1]! - data[0]!) / data[0]!) * 100;
  const up = change >= 0;

  return (
    <div className="sparkline-container mt-3 p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "#10b981" : "#ef4444"} stopOpacity="0.2" />
            <stop offset="100%" stopColor={up ? "#10b981" : "#ef4444"} stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#sparkGrad)" />
        <path d={path} fill="none" stroke={up ? "#10b981" : "#ef4444"} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-between px-3 text-[10px] font-mono">
        <span className="text-slate-400">7d</span>
        <span className={up ? "text-emerald-400 font-semibold" : "text-red-400 font-semibold"}>
          {up ? "+" : ""}{change.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

/* ---- Presentational primitives ---- */

function Skeleton({ className }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

function Card({ children }: { readonly children: ReactNode }) {
  return (
    <motion.section
      initial="initial"
      animate="in"
      exit="out"
      className="glass-card rounded-xl p-5"
    >
      {children}
    </motion.section>
  );
}

function Row({ k, v, mono }: { readonly k: string; readonly v: string; readonly mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2">
      <dt className="shrink-0 text-[--color-muted]">{k}</dt>
      <dd className={`text-right ${mono ? "break-anywhere font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1 block text-sm text-[--color-muted]">{label}</span>
      {children}
    </label>
  );
}

function Input({
  type, value, onChange, placeholder, autoComplete, onEnter,
}: {
  readonly type: "text" | "password";
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly onEnter?: () => void;
}) {
  return (
    <input
      className="w-full rounded-md glass-input px-3 py-2 text-sm outline-none focus:border-[--color-accent] placeholder-slate-500"
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
    />
  );
}

function Button({ children, onClick, busy, disabled, workingLabel }: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly workingLabel?: string;
}) {
  return (
    <button
      className="w-full rounded-md glow-btn bg-[--color-accent] px-4 py-2.5 text-sm font-medium text-[--color-accent-fg] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      onClick={onClick}
      disabled={busy || disabled}
    >
      {busy ? (workingLabel || "Working…") : children}
    </button>
  );
}

function Tab({ children, active, onClick }: {
  readonly children: ReactNode;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={`rounded-md px-3 py-1.5 transition-colors ${
        active
          ? "bg-[--color-accent] text-[--color-accent-fg]"
          : "border border-[--color-border] text-[--color-muted] hover:text-white"
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Qr({ value, chain }: { readonly value: string; readonly chain: string }) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    }
  }
  const size = n + 8;
  return (
    <div className="mt-2 w-36 rounded-md bg-white p-2">
      <svg viewBox={`0 0 ${size} ${size}`} className="block h-full w-full" shapeRendering="crispEdges" role="img" aria-label={`${chain} address QR`}>
        <rect width={size} height={size} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
    </div>
  );
}

/**
 * Receive → Request mode. Lets the user turn a receive address into a shareable
 * payment-request URI (EIP-681 for EVM, BIP-21 for BTC) with an optional amount
 * and — for BTC only, where the standard honours it — a memo. The URI is what
 * gets encoded as the QR and copied, so a payer scans an amount-filled request
 * instead of just a bare address. Invalid amounts are rejected before any URI
 * is produced; nothing partial is ever rendered.
 */
function ReceiveRequest({ balances, addresses, copyToClipboard, T }: {
  readonly balances: readonly Balance[] | null;
  readonly addresses: ReadonlyArray<readonly [ChainId, string]>;
  readonly copyToClipboard: (value: string) => void;
  readonly T: (key: string) => string;
}) {
  const addressByChain = useMemo(() => new Map(addresses), [addresses]);
  const requestable = useMemo(
    () => (balances ?? []).filter((b) => canBuildRequest(b.asset) && addressByChain.has(b.asset.chain)),
    [balances, addressByChain],
  );

  const [selectedKey, setSelectedKey] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");

  if (requestable.length === 0) {
    return <p className="text-sm text-[--color-muted]">{T("receive.req_none")}</p>;
  }

  const selected = requestable.find((b) => assetKey(b.asset) === selectedKey) ?? requestable[0]!;
  const asset = selected.asset;
  const address = addressByChain.get(asset.chain)!;
  const isBtc = asset.chain === "bitcoin";

  let uri = "";
  let invalid = false;
  try {
    uri = buildPaymentRequestUri(asset, address, amount.trim() || undefined, isBtc ? memo.trim() || undefined : undefined);
  } catch (e) {
    if (e instanceof InvalidAmountError) invalid = true;
    else throw e;
  }

  return (
    <div>
      <Field label={T("misc.asset")}>
        <select
          className="w-full rounded-md border border-[--color-border] bg-[--color-bg] px-3 py-2 text-sm outline-none focus:border-[--color-accent]"
          value={assetKey(asset)}
          onChange={(e) => setSelectedKey(e.target.value)}
        >
          {requestable.map((b) => (
            <option key={assetKey(b.asset)} value={assetKey(b.asset)}>
              {b.asset.symbol} {T("misc.on")} {b.asset.chain}
            </option>
          ))}
        </select>
      </Field>

      <Field label={T("receive.req_amount")}>
        <Input type="text" value={amount} onChange={setAmount} placeholder={T("receive.req_amount_ph")} autoComplete="off" />
      </Field>

      {isBtc && (
        <Field label={T("receive.req_memo")}>
          <Input type="text" value={memo} onChange={setMemo} placeholder={T("receive.req_memo_ph")} autoComplete="off" />
        </Field>
      )}

      {invalid ? (
        <p className="text-sm text-red-300">{T("receive.req_invalid")}</p>
      ) : (
        <>
          <div className="mb-1 text-xs uppercase tracking-wide text-[--color-muted]">{T("receive.req_uri")}</div>
          <div className="flex items-start gap-2">
            <code className="flex-1 rounded-md border border-[--color-border] bg-[--color-bg] p-2 text-xs break-anywhere">
              {uri}
            </code>
            <button
              className="shrink-0 rounded-md border border-[--color-border] px-2 py-2 text-xs text-[--color-muted] hover:text-white"
              onClick={() => copyToClipboard(uri)}
              aria-label={T("receive.req_copy")}
              title={T("receive.req_copy")}
            >
              <CopyIcon size={14} />
            </button>
          </div>
          <Qr value={uri} chain={T("receive.req_qr_label")} />
        </>
      )}
    </div>
  );
}

/**
 * Pre-send safety panel (Phase 2). Rendered on the send confirmation screen,
 * between the decoded transaction rows and the Confirm button. It turns the raw
 * intent into plain-language safety signals: a known-official Tether contract
 * badge, who the recipient is (own / saved / recent / new), an address-poisoning
 * warning when the recipient resembles a known address without matching it, a
 * reminder that gas is paid separately from the token amount, and an explorer
 * preview of the recipient. Warnings are visible but non-blocking — the user can
 * still send; they just can't say they weren't told.
 */
function SafetyPanel({ asset, to, contacts, ownAddresses, recentRecipient, recentChain, T }: {
  readonly asset: Asset;
  readonly to: string;
  readonly contacts: readonly Contact[];
  readonly ownAddresses: ReadonlyArray<readonly [ChainId, string]>;
  readonly recentRecipient: string;
  readonly recentChain: ChainId;
  readonly T: (key: string) => string;
}) {
  const ctx = {
    to,
    chain: asset.chain,
    contacts,
    ownAddresses,
    recentRecipient: recentRecipient || undefined,
    recentChain: recentRecipient ? recentChain : undefined,
  };
  const status = classifyRecipient(ctx);
  const poisoning = detectPoisoning(ctx);
  const official = useMemo(() => officialTokenContracts(DEFAULT_ASSETS), []);
  const isToken = asset.token !== undefined;
  const tokenOk = isToken && isOfficialToken(asset, official);
  const recipientUrl = addressExplorerUrl(asset.chain, to);

  return (
    <div className="mb-4 rounded-md border border-[--color-border] bg-[--color-bg] p-3 text-xs">
      <div className="mb-2 font-medium text-[--color-muted]">{T("safety.title")}</div>
      <ul className="flex flex-col gap-1.5">
        <li className="flex items-center gap-2">
          <Globe size={13} className="shrink-0 text-[--color-muted]" />
          <span>{T("safety.sending")} {asset.symbol} {T("misc.on")} {asset.chain}</span>
        </li>

        {isToken && (
          <li className="flex items-center gap-2">
            {tokenOk ? <Shield size={13} className="shrink-0 text-emerald-400" /> : <AlertTriangle size={13} className="shrink-0 text-amber-400" />}
            <span className={tokenOk ? "text-emerald-300" : "text-amber-300"}>{tokenOk ? T("safety.official_token") : T("safety.unknown_token")}</span>
          </li>
        )}

        <li className="flex items-center gap-2">
          {status.kind === "self" && <Info size={13} className="shrink-0 text-sky-400" />}
          {status.kind === "saved" && <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />}
          {status.kind === "recent" && <Info size={13} className="shrink-0 text-sky-400" />}
          {status.kind === "new" && <UserPlus size={13} className="shrink-0 text-amber-400" />}
          <span className={status.kind === "new" ? "text-amber-300" : ""}>
            {status.kind === "self" && T("safety.recipient_self")}
            {status.kind === "saved" && `${T("safety.recipient_saved")}: ${status.name}`}
            {status.kind === "recent" && T("safety.recipient_recent")}
            {status.kind === "new" && T("safety.recipient_new")}
          </span>
        </li>

        {poisoning && (
          <li className="flex items-start gap-2 rounded-md bg-red-500/10 p-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-400" />
            <span className="text-red-300">
              {T("safety.poisoning")}
              <span className="mt-1 block break-anywhere font-mono text-[--color-muted]">
                {T("safety.poisoning_resembles")}: {poisoning.name ? `${poisoning.name} (${poisoning.address})` : poisoning.address}
              </span>
            </span>
          </li>
        )}

        {isToken && (
          <li className="flex items-start gap-2">
            <Info size={13} className="mt-0.5 shrink-0 text-[--color-muted]" />
            <span className="text-[--color-muted]">{T("safety.gas_note")}</span>
          </li>
        )}

        {recipientUrl && (
          <li className="flex items-center gap-2">
            <ExternalLink size={13} className="shrink-0 text-[--color-muted]" />
            <a href={recipientUrl} target="_blank" rel="noopener noreferrer" className="text-[--color-muted] underline-offset-2 hover:underline">
              {T("safety.view_recipient")}
            </a>
          </li>
        )}
      </ul>
    </div>
  );
}

function QrScanner({ onResult, label, closeLabel, cancelLabel }: { readonly onResult: (address: string) => void; readonly label: string; readonly closeLabel?: string; readonly cancelLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const s = streamRef.current;
    if (s) { for (const t of s.getTracks()) t.stop(); streamRef.current = null; }
    const v = videoRef.current;
    if (v) v.srcObject = null;
  }, []);

  useEffect(() => stop, [stop]);

  const close = useCallback(() => { stop(); setOpen(false); }, [stop]);

  const start = useCallback(() => {
    setScanError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setScanError("Camera scanning needs a secure context (https or localhost). Type or paste the address instead.");
      setOpen(true);
      return;
    }
    setOpen(true);
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) { stop(); return; }
        v.srcObject = stream;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const tick = () => {
          rafRef.current = null;
          if (!streamRef.current) return;
          if (ctx && v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code) { onResult(extractAddress(code.data)); stop(); setOpen(false); return; }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((e: unknown) => {
        const name = e instanceof Error ? e.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") setScanError("Camera permission denied. Type or paste the address instead.");
        else if (name === "NotFoundError" || name === "OverconstrainedError") setScanError("No camera found. Type or paste the address instead.");
        else setScanError("Could not start the camera. Type or paste the address instead.");
      });
  }, [onResult, stop]);

  if (!open) {
    return (
      <button type="button" className="mb-4 rounded-md border border-[--color-border] px-3 py-1.5 text-xs text-[--color-muted] hover:text-white" onClick={start}>
        {label}
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-md border border-[--color-border] bg-[--color-bg] p-2">
      {scanError ? (
        <p className="text-xs text-red-300">{scanError}</p>
      ) : (
        <video ref={videoRef} autoPlay playsInline muted className="block w-full rounded-md" aria-label="QR scanner camera preview" />
      )}
      <button type="button" className="mt-2 rounded-md border border-[--color-border] px-3 py-1.5 text-xs text-[--color-muted] hover:text-white" onClick={close}>
        {scanError ? (closeLabel || "Close") : (cancelLabel || "Cancel")}
      </button>
    </div>
  );
}
