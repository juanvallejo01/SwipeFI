"use client";

/**
 * TransactionTerminal — an expandable bottom drawer that shows the technical
 * trace of the atomic "Zap & Yield" SwapVM batch returned by `/api/swap`.
 *
 * Collapsed it is a single glass bar with a live fork-status pill. Expanded it
 * prints a monospace log:
 *
 *   > execution_id   0x……            (local FNV-1a over the compiled calldata)
 *   > swapvm_router   0x……
 *   > atomic_batch    executeAtomic([aqua-swap, lido-submit])
 *   > gas_estimate    420000 units
 *   > gas_saved       ~88,000 gas (17%) · swap + stake batched, no approval tx
 *   > net_balance     -5,000 USDC  ➔  +2.01 stETH
 *   > projected_apy   3.4% (Lido Staking)
 *   > network         <resolved per environment — see detectNetwork()>
 *
 * The drawer smooth-slides up from off-screen the moment `result` becomes
 * non-null, and auto-expands on the first compiled response. While expanded it
 * claims the screen with a dark blur backdrop so nothing overlaps the logs.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Copy,
  Info,
  Receipt,
  Settings,
} from "lucide-react";
import type { ZapResult } from "@/components/CardDeck";
import { DEFAULT_ZAP_AMOUNT, useActiveWallet } from "@/hooks/useSwapPosition";

interface TransactionTerminalProps {
  /** Latest compiled SwapVM batch, or `null` to keep the drawer off-screen. */
  result: ZapResult | null;
  /** Dismiss the drawer entirely (clears the upstream result). */
  onClose: () => void;
  /** Fires whenever the drawer expands / collapses — the page uses `true` to
   *  retract the toast so the two never share the screen. */
  onExpandedChange?: (expanded: boolean) => void;
}

/**
 * Wait for the top toast to auto-dismiss before the drawer auto-expands, so a
 * tall expanded sheet and the toast never overlap. Must stay >= the toast's
 * own AUTO_DISMISS_MS (3.0s).
 */
const AUTO_EXPAND_DELAY_MS = 3_200;

interface NetworkInfo {
  label: string;
  /** True → live mainnet RPC; false → local Hardhat fork. */
  live: boolean;
}

// Hosts that mean "real mainnet RPC" when they show up in NEXT_PUBLIC_ETH_RPC_URL.
const LIVE_RPC_HOST_RE =
  /(infura|alchemy|quiknode|quicknode|ankr|llamarpc|cloudflare-eth|blastapi|chainstack|nodereal|drpc)\./i;
const LOCAL_HOST = new Set(["localhost", "127.0.0.1", "0.0.0.0", ""]);

/**
 * Decide whether the SwapVM batch was compiled against a live mainnet RPC or
 * the local Hardhat fork. Client-only, so it can only see `NEXT_PUBLIC_*` env
 * (a non-public `ETH_RPC_URL` never reaches the browser) plus the page host:
 *
 *   - `NEXT_PUBLIC_VERCEL_ENV` is "production" / "preview"          → live
 *   - `NEXT_PUBLIC_ETH_RPC_URL` points at Infura/Alchemy/etc.       → live
 *   - deployed on a non-local host and not explicitly "development" → live
 *   - otherwise                                                     → local fork
 */
function detectNetwork(): NetworkInfo {
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV;
  const rpc = (process.env.NEXT_PUBLIC_ETH_RPC_URL ?? "").toLowerCase();
  const host =
    typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";

  const liveByVercel = vercelEnv === "production" || vercelEnv === "preview";
  const liveByRpc =
    LIVE_RPC_HOST_RE.test(rpc) && !/127\.0\.0\.1|localhost/.test(rpc);
  const liveByHost =
    !LOCAL_HOST.has(host) &&
    !host.endsWith(".local") &&
    vercelEnv !== "development";

  return liveByVercel || liveByRpc || liveByHost
    ? { label: "Ethereum Mainnet · 1inch Aqua SwapVM", live: true }
    : FORK_NETWORK;
}

const FORK_NETWORK: NetworkInfo = {
  label: "Mainnet Fork / Hardhat Local · 127.0.0.1:8545",
  live: false,
};

// Environment never changes at runtime — resolve once, hand back a stable ref.
let cachedNetwork: NetworkInfo | null = null;
function getNetworkSnapshot(): NetworkInfo {
  if (!cachedNetwork) cachedNetwork = detectNetwork();
  return cachedNetwork;
}
function getServerNetworkSnapshot(): NetworkInfo {
  return FORK_NETWORK;
}
const subscribeNetwork = () => () => {};

function useNetwork(): NetworkInfo {
  return useSyncExternalStore(
    subscribeNetwork,
    getNetworkSnapshot,
    getServerNetworkSnapshot
  );
}

// tsconfig targets ES2017, so bigint literals (`1n`) are off-limits — use the
// `BigInt(...)` constructor form, matching the rest of the codebase.
const MILLION = BigInt(1_000_000);
const ONE_ETHER = BigInt("1000000000000000000"); // 1e18
const ONE_CENT = BigInt("10000000000000000"); //    1e16
/** Naive baseline saved by the atomic batch: a separate ERC-20 approve tx… */
const APPROVAL_GAS = BigInt(46_000);
/** …plus the 21k intrinsic cost of the 2 extra transactions it collapses. */
const EXTRA_INTRINSIC_GAS = BigInt(42_000);
const FALLBACK_GAS = BigInt(420_000);

/** "5000000000" (6dp USDC) → "5,000". */
function formatUsdc(atomic: string): string {
  if (!/^\d+$/.test(atomic)) return "5,000";
  return (BigInt(atomic) / MILLION).toLocaleString("en-US");
}

/** stETH wei string → short "2.01"-style decimal, with a demo fallback. */
function formatSteth(raw: string | null | undefined): string {
  if (!raw || !/^\d+$/.test(raw)) return "2.01";
  try {
    const wei = BigInt(raw);
    const whole = wei / ONE_ETHER;
    const hundredths = (wei % ONE_ETHER) / ONE_CENT;
    return `${whole.toString()}.${hundredths.toString().padStart(2, "0")}`;
  } catch {
    return "2.01";
  }
}

/** Deterministic display id (FNV-1a) over the compiled calldata — NOT an
 *  on-chain tx hash: the SwapVM batch is compiled, never broadcast. */
function executionId(data: string): string {
  const MASK = BigInt("18446744073709551615"); // 2^64 - 1
  const PRIME = BigInt("1099511628211");
  let h = BigInt("14695981039346656037"); // FNV offset basis
  for (let i = 0; i < data.length; i++) {
    h = (h ^ BigInt(data.charCodeAt(i))) & MASK;
    h = (h * PRIME) & MASK;
  }
  return `0x${h.toString(16).padStart(16, "0")}`;
}

/** "Lido Staking" → "Lido" — the receipt reads better without the suffix. */
function shortProtocolName(protocol: string): string {
  return protocol.replace(/\s+Staking$/i, "");
}

function gasSaved(estimatedGas: string): { abs: string; pct: string } {
  let exec: bigint;
  try {
    exec = BigInt(estimatedGas);
  } catch {
    exec = FALLBACK_GAS;
  }
  const saved = APPROVAL_GAS + EXTRA_INTRINSIC_GAS; // 88,000
  const pct = Number((saved * BigInt(10_000)) / (exec + saved)) / 100;
  return { abs: saved.toLocaleString("en-US"), pct: `${pct.toFixed(0)}%` };
}

interface LogLineProps {
  name: string;
  value: string;
  tone?: "accent" | "warn";
  copyable?: boolean;
  copied?: boolean;
  onCopy?: () => void;
}

function LogLine({
  name,
  value,
  tone,
  copyable,
  copied,
  onCopy,
}: LogLineProps) {
  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 select-none text-slate-600">&gt;</span>
      <span className="w-[92px] shrink-0 select-none text-slate-500">
        {name}
      </span>
      <span
        className={`min-w-0 flex-1 break-all ${
          tone === "accent"
            ? "text-emerald-300"
            : tone === "warn"
            ? "text-amber-300"
            : "text-slate-300"
        }`}
      >
        {value}
      </span>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${name}`}
          className="shrink-0 text-slate-600 transition hover:text-slate-200"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-400" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}

interface ReceiptRowProps {
  label: string;
  value: string;
  tone?: "accent";
}

/** One line of the human-readable receipt — label left, value right. */
function ReceiptRow({ label, value, tone }: ReceiptRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <span
        className={`text-right text-sm font-semibold ${
          tone === "accent" ? "text-emerald-300" : "text-slate-100"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default function TransactionTerminal({
  result,
  onClose,
  onExpandedChange,
}: TransactionTerminalProps) {
  const [expanded, setExpanded] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const hadResult = useRef(false);
  const prevExpanded = useRef(expanded);
  const wallet = useActiveWallet();
  const network = useNetwork();

  // Notify the page (only on a real transition) so it can retract the toast.
  useEffect(() => {
    if (prevExpanded.current !== expanded) {
      prevExpanded.current = expanded;
      onExpandedChange?.(expanded);
    }
  }, [expanded, onExpandedChange]);

  // On the first compiled batch, slide the collapsed bar in now but defer the
  // expand until the toast has cleared — they must never share the screen.
  useEffect(() => {
    if (!result || hadResult.current) {
      hadResult.current = result !== null;
      return;
    }
    hadResult.current = true;
    const timer = window.setTimeout(
      () => setExpanded(true),
      AUTO_EXPAND_DELAY_MS
    );
    return () => window.clearTimeout(timer);
  }, [result]);

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(
        () => setCopiedKey((c) => (c === key ? null : c)),
        1200
      );
    } catch {
      // Clipboard is unavailable in some Telegram webviews — fail silently.
    }
  }

  const meta = result?.meta ?? null;
  const tx = result?.tx ?? null;
  const usdcIn = formatUsdc(DEFAULT_ZAP_AMOUNT);
  const stethOut = formatSteth(meta?.expectedOut);
  const yieldToken = meta?.yieldToken ?? "stETH";
  const apy = meta?.estimatedApy ?? "3.4%";
  const protocol = meta?.targetProtocol ?? "Lido Staking";
  const protocolShort = shortProtocolName(protocol);
  const saved = tx ? gasSaved(tx.estimatedGas) : null;
  const execId = tx ? executionId(tx.data) : "";
  const warnings = result?.warnings ?? [];

  const pillClass = network.live
    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
    : "border-amber-400/30 bg-amber-500/10 text-amber-300";
  const dotClass = network.live ? "bg-emerald-400" : "bg-amber-400";

  return (
    <AnimatePresence>
      {/* Dark blur backdrop — gives the sheet clean bottom-sheet priority so
          nothing (toast, deck, header) overlaps the logs while it is open. */}
      {result && tx && expanded && (
        <motion.div
          key="tx-terminal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => setExpanded(false)}
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm"
        />
      )}

      {result && tx && (
        <motion.aside
          key="tx-terminal"
          initial={{ y: "115%" }}
          animate={{ y: 0 }}
          exit={{ y: "115%" }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 shadow-2xl shadow-black/40 backdrop-blur-md">
            {/* Collapsed bar / toggle */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-2 px-4 py-3 text-left"
            >
              <Receipt className="h-4 w-4 shrink-0 text-emerald-300" />
              <span className="font-mono text-xs font-semibold tracking-wide text-slate-200">
                TRANSACTION RECEIPT
              </span>

              {/* Network / Fork status indicator (live mainnet vs local fork) */}
              <span
                className={`ml-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${pillClass}`}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span
                    className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotClass} opacity-70`}
                  />
                  <span
                    className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotClass}`}
                  />
                </span>
                {network.live ? "MAINNET" : "FORK"}
              </span>

              <motion.span
                className="ml-auto shrink-0 text-slate-400"
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="h-4 w-4" />
              </motion.span>
            </button>

            {/* Expandable technical log — capped so Telegram's bottom nav can
                never clip it; scrolls internally instead. */}
            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  key="terminal-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="max-h-[82vh] overflow-y-auto overscroll-contain"
                >
                  <div className="space-y-3 border-t border-white/10 px-4 py-3">
                    {/* Off-chain compiled badge — makes it unmistakable that
                        nothing has moved on-chain yet. */}
                    <div className="relative inline-flex">
                      <button
                        type="button"
                        onClick={() => setShowInfo((v) => !v)}
                        aria-expanded={showInfo}
                        title="Funds haven't moved yet — this batch is compiled and waits for your wallet to confirm and broadcast it on-chain."
                        className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-300 transition hover:bg-sky-500/20"
                      >
                        <Info className="h-3 w-3" />
                        Off-Chain Compiled
                      </button>

                      <AnimatePresence>
                        {showInfo && (
                          <motion.div
                            key="offchain-info"
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.15 }}
                            className="absolute left-0 top-full z-10 mt-2 w-64 rounded-lg border border-white/10 bg-slate-900/95 p-2.5 text-[11px] leading-snug text-slate-300 shadow-xl"
                          >
                            Funds haven&rsquo;t moved yet. This batch is
                            compiled and sits ready — nothing broadcasts
                            on-chain until you confirm it in your wallet.
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* User Receipt — the primary, human-readable view. */}
                    <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5 px-3">
                      <ReceiptRow
                        label="You Swapped"
                        value={`${usdcIn} USDC`}
                      />
                      <ReceiptRow
                        label="You Earn"
                        tone="accent"
                        value={`~${stethOut} ${yieldToken} (${apy} APY via ${protocolShort})`}
                      />
                      <ReceiptRow
                        label="Gas Saved"
                        tone="accent"
                        value={
                          saved
                            ? `~${saved.abs} units (${saved.pct} faster & cheaper via 1inch Aqua)`
                            : "—"
                        }
                      />
                      <ReceiptRow
                        label="Action Status"
                        value="Batch Ready for Wallet Broadcast"
                      />
                    </div>

                    {/* Toggle: raw SwapVM trace, for hackathon judges. */}
                    <button
                      type="button"
                      onClick={() => setShowTrace((v) => !v)}
                      aria-expanded={showTrace}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-[11px] font-semibold text-slate-300 transition hover:bg-white/10"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      {showTrace
                        ? "Hide SwapVM Developer Trace"
                        : "Show SwapVM Developer Trace"}
                    </button>

                    <AnimatePresence initial={false}>
                      {showTrace && (
                        <motion.div
                          key="dev-trace"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-1.5 border-t border-white/10 pt-3 font-mono text-[11px] leading-relaxed">
                            <LogLine
                              name="execution_id"
                              value={execId}
                              copyable
                              copied={copiedKey === "execution_id"}
                              onCopy={() => copy("execution_id", execId)}
                            />
                            <LogLine
                              name="swapvm_router"
                              value={tx.to}
                              copyable
                              copied={copiedKey === "swapvm_router"}
                              onCopy={() => copy("swapvm_router", tx.to)}
                            />
                            <LogLine
                              name="atomic_batch"
                              value="executeAtomic([aqua-swap: USDC→ETH, lido-submit: ETH→stETH])"
                            />
                            <LogLine
                              name="gas_estimate"
                              value={`${Number(tx.estimatedGas).toLocaleString(
                                "en-US"
                              )} units`}
                            />
                            {saved && (
                              <LogLine
                                name="gas_saved"
                                tone="accent"
                                value={`~${saved.abs} gas (${saved.pct}) · Aqua SwapVM batches swap + stake, no separate approval tx`}
                              />
                            )}
                            <LogLine
                              name="net_balance"
                              tone="accent"
                              value={`-${usdcIn} USDC  ➔  +${stethOut} ${yieldToken}`}
                            />
                            <LogLine
                              name="projected_apy"
                              value={`${apy} (${protocol})`}
                            />
                            <LogLine
                              name="wallet"
                              value={`${wallet.address}  (${wallet.source}${
                                wallet.isDemo ? " · demo" : ""
                              })`}
                              copyable
                              copied={copiedKey === "wallet"}
                              onCopy={() => copy("wallet", wallet.address)}
                            />
                            <LogLine
                              name="network"
                              tone={network.live ? "accent" : undefined}
                              value={network.label}
                            />
                            {warnings.map((w, i) => (
                              <LogLine
                                key={i}
                                name="warn"
                                tone="warn"
                                value={w}
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex items-center justify-between border-t border-white/10 px-4 py-2">
                    <span className="font-mono text-[10px] text-slate-500">
                      SwapVM · compiled, not broadcast
                    </span>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10"
                    >
                      Close
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
