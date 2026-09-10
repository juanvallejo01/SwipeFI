"use client";

/**
 * TransactionToast — compact top-floating status pill shown the moment a
 * swipe-right finishes compiling. It is a lightweight confirmation only
 * ("Zap compiled · 5,000 USDC → 2.01 stETH"); the full technical breakdown
 * lives in TransactionTerminal.
 *
 * It is docked at `top-4`, centred, `z-50`, and auto-dismisses after 3.0s so it
 * never collides with the header text or the bottom drawer.
 */

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, X, Zap } from "lucide-react";
import type { ZapResult } from "@/components/CardDeck";
import {
  DEFAULT_ZAP_AMOUNT,
  type SwapPositionMeta,
} from "@/hooks/useSwapPosition";

/** Slides out on its own after this long so it never sits over the terminal. */
const AUTO_DISMISS_MS = 3_000;

interface TransactionToastProps {
  open: boolean;
  result: ZapResult | null;
  onDismiss: () => void;
}

/** "5000000000" (6dp USDC) → "5,000". */
function formatUsdc(atomic: string): string {
  if (!/^\d+$/.test(atomic)) return "5,000";
  return (BigInt(atomic) / BigInt(1_000_000)).toLocaleString("en-US");
}

/** stETH wei string → short "2.01"-style decimal, with a demo fallback. */
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

export default function TransactionToast({
  open,
  result,
  onDismiss,
}: TransactionToastProps) {
  // Auto-dismiss: the terminal owns the bottom sheet and auto-expands shortly
  // after, so the pill retreats upward well before that happens.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [open, result, onDismiss]);

  const meta = result?.meta ?? null;
  const steth = formatExpectedSteth(meta);
  const usdcIn = formatUsdc(DEFAULT_ZAP_AMOUNT); // 5,000 USDC per Zap
  const yieldToken = meta?.yieldToken ?? "stETH";
  const apy = meta?.estimatedApy ?? "3.4%";

  return (
    <AnimatePresence>
      {open && result && (
        <motion.div
          key="tx-toast"
          role="status"
          aria-live="polite"
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", stiffness: 340, damping: 32 }}
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 px-4"
        >
          <div className="glass-panel flex max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-full border-emerald-400/25 py-2 pl-3 pr-2 shadow-2xl shadow-emerald-500/10">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
              <Zap className="h-3.5 w-3.5" />
            </span>

            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold text-slate-100">
              <span className="text-emerald-300">Zap compiled</span>
              <span className="text-slate-500">·</span>
              <span>{usdcIn} USDC</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span>
                {steth} {yieldToken}
              </span>
              <span className="hidden text-slate-400 min-[380px]:inline">
                ({apy} APY)
              </span>
            </span>

            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss notification"
              className="ml-1 shrink-0 rounded-full border border-white/10 bg-white/5 p-1 text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
