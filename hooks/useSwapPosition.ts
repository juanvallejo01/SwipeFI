"use client";

/**
 * useSwapPosition — client hook that calls `POST /api/swap` to compile the
 * atomic "Zap & Yield" SwapVM calldata (1inch Aqua swap USDC → ETH, then Lido
 * `submit` → stETH, packed into one `executeAtomic` batch).
 *
 * `openPosition({ toToken })` fires the request and both:
 *   - drives the hook's state machine (`isLoading` → `isSuccess` / `error`), and
 *   - resolves to the compiled result so the caller can hand it straight to a
 *     parent view without waiting for a re-render.
 *
 * The request is aborted if the component unmounts or a newer swipe comes in.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** Canonical mainnet USDC — the source token for every Zap & Yield position. */
export const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
/** Canonical mainnet WETH — the default swap target / native-ETH stand-in. */
export const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
/**
 * Hardhat / Anvil test account #0 — the wallet the Day 3 mainnet fork funds
 * with 5,000 USDC and 10 ETH for gas. Used whenever no real wallet is attached.
 */
export const TEST_WALLET_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
/** 5,000 USDC in atomic units (USDC has 6 decimals). */
export const DEFAULT_ZAP_AMOUNT = "5000000000";

const SWAP_ENDPOINT = "/api/swap";

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Where the active address came from. `"demo"` → the funded fork test account. */
export type WalletSource = "injected" | "telegram" | "demo";

export interface ActiveWallet {
  address: string;
  source: WalletSource;
  /** True when we fell back to {@link TEST_WALLET_ADDRESS}. */
  isDemo: boolean;
  /** Telegram `@username` / first name, when opened inside a Telegram client. */
  telegramUser: string | null;
}

const DEMO_WALLET: ActiveWallet = {
  address: TEST_WALLET_ADDRESS,
  source: "demo",
  isDemo: true,
  telegramUser: null,
};

interface InjectedProvider {
  selectedAddress?: string | null;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

/**
 * Resolves the wallet to sign the Zap with, browser-only:
 *   1. an injected EVM provider (`window.ethereum`) with an already-connected
 *      account — no popup, we only read `selectedAddress`;
 *   2. an address surfaced by a wallet-enabled Telegram client on
 *      `WebApp.initDataUnsafe.user`;
 *   3. otherwise the funded fork test account, flagged `isDemo`.
 */
function resolveActiveWallet(): ActiveWallet {
  if (typeof window === "undefined") return DEMO_WALLET;

  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user as
    | { wallet_address?: string; username?: string; first_name?: string }
    | undefined;
  const telegramUser = tgUser
    ? tgUser.username
      ? `@${tgUser.username}`
      : (tgUser.first_name ?? null)
    : null;

  const injected = (window as { ethereum?: InjectedProvider }).ethereum
    ?.selectedAddress;
  if (injected && EVM_ADDRESS_RE.test(injected)) {
    return { address: injected, source: "injected", isDemo: false, telegramUser };
  }

  if (tgUser?.wallet_address && EVM_ADDRESS_RE.test(tgUser.wallet_address)) {
    return {
      address: tgUser.wallet_address,
      source: "telegram",
      isDemo: false,
      telegramUser,
    };
  }

  return { ...DEMO_WALLET, telegramUser };
}

// Cache the snapshot so `useSyncExternalStore` sees a stable reference until the
// resolved wallet actually changes (same pattern as WelcomeHeader's TG store).
let cachedWallet: ActiveWallet = DEMO_WALLET;

function getWalletSnapshot(): ActiveWallet {
  const next = resolveActiveWallet();
  if (
    next.address === cachedWallet.address &&
    next.source === cachedWallet.source &&
    next.telegramUser === cachedWallet.telegramUser
  ) {
    return cachedWallet;
  }
  cachedWallet = next;
  return next;
}

function getServerWalletSnapshot(): ActiveWallet {
  return DEMO_WALLET;
}

function subscribeWallet(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const provider = (window as { ethereum?: InjectedProvider }).ethereum;
  provider?.on?.("accountsChanged", onChange);
  return () => provider?.removeListener?.("accountsChanged", onChange);
}

/**
 * Live view of the active wallet. Renders the demo account on the server and the
 * first client paint (no hydration mismatch), then reflects the injected /
 * Telegram address, updating on `accountsChanged`.
 */
export function useActiveWallet(): ActiveWallet {
  return useSyncExternalStore(
    subscribeWallet,
    getWalletSnapshot,
    getServerWalletSnapshot,
  );
}

/** Yield metadata surfaced to the UI (subset of the route's `meta` object). */
export interface SwapPositionMeta {
  /** Expected swap output in `toToken` atomic units, or `null` if no quote. */
  expectedOut: string | null;
  yieldToken: string;
  targetProtocol: string;
  /** Headline APY string, e.g. "3.4%". */
  estimatedApy: string;
}

/** The compiled transaction the wallet would sign. */
export interface SwapPositionTx {
  to: string;
  data: string;
  value: string;
  estimatedGas: string;
}

/** Everything `openPosition` resolves with on success. */
export interface SwapPositionResult {
  tx: SwapPositionTx;
  meta: SwapPositionMeta;
  warnings: string[];
}

/** Optional per-call overrides; anything omitted falls back to the demo defaults. */
export interface OpenPositionArgs {
  /** Swap target address for the Aqua leg (the swiped card's token). */
  toToken?: string;
  fromToken?: string;
  amount?: string;
  walletAddress?: string;
}

interface SwapApiSuccess {
  success: true;
  to: string;
  data: string;
  value: string;
  estimatedGas: string;
  meta: {
    expectedOut: string | null;
    yieldToken?: string;
    targetProtocol?: string;
    estimatedApy?: string;
    [key: string]: unknown;
  };
  warnings?: string[];
}

interface SwapApiError {
  success: false;
  error: string;
  field?: string | null;
}

type SwapApiResponse = SwapApiSuccess | SwapApiError;

export interface UseSwapPositionResult {
  /** Fire `POST /api/swap`; resolves to the result, or `null` on error/abort. */
  openPosition: (args?: OpenPositionArgs) => Promise<SwapPositionResult | null>;
  /** Clear all state (and abort any in-flight request). */
  reset: () => void;
  isLoading: boolean;
  isSuccess: boolean;
  error: string | null;
  txData: SwapPositionTx | null;
  meta: SwapPositionMeta | null;
  warnings: string[];
  /** Wallet `openPosition` signs with when `walletAddress` is not passed. */
  activeWallet: ActiveWallet;
}

export function useSwapPosition(): UseSwapPositionResult {
  const activeWallet = useActiveWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txData, setTxData] = useState<SwapPositionTx | null>(null);
  const [meta, setMeta] = useState<SwapPositionMeta | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Abort an in-flight request on unmount or when a newer swipe supersedes it.
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setIsLoading(false);
    setIsSuccess(false);
    setError(null);
    setTxData(null);
    setMeta(null);
    setWarnings([]);
  }, []);

  const openPosition = useCallback<UseSwapPositionResult["openPosition"]>(
    async (args = {}) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setIsLoading(true);
      setIsSuccess(false);
      setError(null);

      const payload = {
        fromToken: args.fromToken ?? USDC_ADDRESS,
        toToken: args.toToken ?? WETH_ADDRESS,
        amount: args.amount ?? DEFAULT_ZAP_AMOUNT,
        walletAddress: args.walletAddress ?? activeWallet.address,
      };

      try {
        const res = await fetch(SWAP_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const json = (await res.json().catch(() => null)) as SwapApiResponse | null;

        // A stale/aborted response must not clobber newer state.
        if (!mountedRef.current || controller.signal.aborted) return null;

        if (!res.ok || !json || json.success !== true) {
          const message =
            json && "error" in json && json.error
              ? json.error
              : `Swap route returned HTTP ${res.status}`;
          setError(message);
          setIsLoading(false);
          return null;
        }

        const nextTx: SwapPositionTx = {
          to: json.to,
          data: json.data,
          value: json.value,
          estimatedGas: json.estimatedGas,
        };
        const nextMeta: SwapPositionMeta = {
          expectedOut: json.meta.expectedOut ?? null,
          yieldToken: json.meta.yieldToken ?? "stETH",
          targetProtocol: json.meta.targetProtocol ?? "Lido Staking",
          estimatedApy: json.meta.estimatedApy ?? "3.4%",
        };
        const nextWarnings = json.warnings ?? [];

        setTxData(nextTx);
        setMeta(nextMeta);
        setWarnings(nextWarnings);
        setIsSuccess(true);
        setIsLoading(false);

        return { tx: nextTx, meta: nextMeta, warnings: nextWarnings };
      } catch (err) {
        if (controller.signal.aborted || !mountedRef.current) return null;
        setError(
          err instanceof Error
            ? err.message
            : "Network error calling /api/swap",
        );
        setIsLoading(false);
        return null;
      }
    },
    [activeWallet.address],
  );

  return {
    openPosition,
    reset,
    isLoading,
    isSuccess,
    error,
    txData,
    meta,
    warnings,
    activeWallet,
  };
}

export default useSwapPosition;
