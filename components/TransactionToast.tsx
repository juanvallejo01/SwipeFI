"use client";

/**
 * TransactionToast — dark glassmorphic notification that slides up from the
 * bottom of the screen when a swipe-right finishes compiling. It reports the
 * atomic "Zap & Yield" batch that `/api/swap` returned:
 *
 *   Badge   · "1inch SwapVM Atomic Execution"
 *   Flow    · 5,000 USDC ➔ stETH (Lido Yield)
 *   Yield   · "<apy> APY (~<stETH> stETH)"
 *   Status  · "SwapVM Batch Compiled On-Chain" + target router
 */

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, X, Zap } from "lucide-react";
import type { ZapResult } from "@/components/CardDeck";
import {
  DEFAULT_ZAP_AMOUNT,
  type SwapPositionMeta,
} from "@/hooks/useSwapPosition";

interface TransactionToastProps {
  open: boolean;
  result: ZapResult | null;
  onDismiss: () => void;
}

/** "5000000000" (6dp USDC) → "5,000". */
function formatUsdc(atomic: string): string {
  if (!/^\d+$/.test(atomic)) return "5,000";
  const whole = BigInt(atomic) / BigInt(1_000_000);
  return whole.toLocaleString("en-US");
}

/** WETH/stETH wei string → short "2.01"-style decimal, with a demo fallback. */
function formatExpectedSteth(meta: SwapPositionMeta | null): string {
  const raw = meta?.expectedOut;
  if (!raw || !/^\d+$/.test(raw)) return "2.01";
  try {
    const wei = BigInt(raw);
    const oneEther = BigInt("1000000000000000000"); // 1e18
    const oneCent = BigInt("10000000000000000"); //     1e16
    const whole = wei / oneEther;
    const hundredths = (wei % oneEther) / oneCent;
    return `${whole.toString()}.${hundredths.toString().padStart(2, "0")}`;
  } catch {
    return "2.01";
  }
}

function shortAddress(address: string | undefined): string {
  if (!address || address.length < 10) return "SwapVM Router";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function TransactionToast({
  open,
  result,
  onDismiss,
}: TransactionToastProps) {
  const meta = result?.meta ?? null;
  const apy = meta?.estimatedApy ?? "3.4%";
  const steth = formatExpectedSteth(meta);
  const usdcIn = formatUsdc(DEFAULT_ZAP_AMOUNT); // 5,000 USDC per Zap
  const yieldToken = meta?.yieldToken ?? "stETH";
  const protocol = meta?.targetProtocol ?? "Lido Staking";

  return (
    <AnimatePresence>
      {open && result && (
        <motion.div
          key="tx-toast"
          role="status"
          aria-live="polite"
          initial={{ y: 140, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 140, opacity: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 32 }}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-sm px-4 pb-6"
        >
          <div className="glass-panel relative overflow-hidden rounded-3xl border-emerald-400/20 p-5 text-left shadow-2xl shadow-emerald-500/10">
            {/* wash de color de fondo */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-500/20 blur-3xl"
            />

            <div className="relative flex items-start justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-300">
                <Zap className="h-3.5 w-3.5" />
                1inch SwapVM Atomic Execution
              </span>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss notification"
                className="rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Flow summary */}
            <div className="relative mt-4 flex items-center gap-2 text-lg font-bold text-slate-50">
              <span>{usdcIn} USDC</span>
              <ArrowRight className="h-5 w-5 text-emerald-400" />
              <span>{yieldToken}</span>
              <span className="text-sm font-medium text-slate-400">
                ({protocol.replace(" Staking", "")} Yield)
              </span>
            </div>

            {/* Yield metrics */}
            <div className="relative mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Projected yield
              </span>
              <span className="text-sm font-semibold text-emerald-300">
                {apy} APY (~{steth} {yieldToken})
              </span>
            </div>

            {/* Target router & status */}
            <div className="relative mt-3 flex items-center gap-2 text-xs text-slate-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="font-semibold text-slate-200">
                SwapVM Batch Compiled On-Chain
              </span>
              <span className="ml-auto font-mono text-[11px] text-slate-500">
                {shortAddress(result.tx.to)}
              </span>
            </div>

            {result.warnings.length > 0 && (
              <p className="relative mt-3 text-[11px] leading-relaxed text-amber-300/80">
                {result.warnings.join(" · ")}
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
