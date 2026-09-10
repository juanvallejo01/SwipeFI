"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, RotateCcw } from "lucide-react";
import SwipeCard from "@/components/SwipeCard";
import {
  useSwapPosition,
  WETH_ADDRESS,
  type SwapPositionResult,
} from "@/hooks/useSwapPosition";

export interface Token {
  /** Asset the USDC gets zapped into. */
  symbol: string;
  name: string;
  /** Local asset path, e.g. "/tokens/eth.avif". */
  icon: string;
  /** Optional yield-protocol mark shown on the action chip. */
  yieldIcon?: string;
  /** Destination protocol, e.g. "Lido Staking". */
  protocol: string;
  /** Headline APY as a display string, e.g. "3.4%". */
  apy: string;
  /** One-line flow, e.g. "Zap USDC ➔ stETH". */
  action: string;
  /** 24h change — drives the trend colour + sign. */
  change24h: number;
  /** 7-day trend points for the sparkline (oldest → newest). */
  spark: number[];
}

/** A compiled Zap & Yield position, tagged with the card that produced it. */
export interface ZapResult extends SwapPositionResult {
  token: Token;
}

interface CardDeckProps {
  /** Called once `/api/swap` returns the compiled SwapVM batch for a swipe-right. */
  onZap?: (result: ZapResult) => void;
  /** Fires with the symbol of the card now on top (or `null` when the deck is
   *  empty) — drives the page's reactive background glow. */
  onActiveTokenChange?: (symbol: string | null) => void;
}

// Mainnet ERC-20 addresses for the swap leg of the Zap & Yield flow. This map
// only picks which token 1inch Aqua routes the USDC through first; USDC and SOL
// fall back to WETH for the demo swap leg.
const TOKEN_ADDRESSES: Record<string, string> = {
  ETH: WETH_ADDRESS,
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
};

// Curated demo strategies. Day 3 will replace the static APY / trend with a
// real price + yield feed.
const STRATEGIES: Token[] = [
  {
    symbol: "ETH",
    name: "Ethereum",
    icon: "/tokens/eth.avif",
    yieldIcon: "/tokens/lido.png",
    protocol: "Lido Staking",
    apy: "3.4%",
    action: "Zap USDC ➔ stETH",
    change24h: 2.4,
    spark: [38, 40, 39, 43, 47, 46, 52, 55],
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    icon: "/tokens/usdc.webp",
    yieldIcon: "/tokens/aave.png",
    protocol: "Aave V3",
    apy: "4.8%",
    action: "Deposit USDC ➔ aUSDC",
    change24h: 0.1,
    spark: [50, 50, 51, 50, 50, 51, 50, 51],
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    icon: "/tokens/wbtc.png",
    protocol: "1inch Aqua Batch",
    apy: "2.1%",
    action: "Zap USDC ➔ WBTC",
    change24h: -0.8,
    spark: [60, 58, 59, 55, 53, 54, 52, 51],
  },
  {
    symbol: "SOL",
    name: "Solana",
    icon: "/tokens/sol.png",
    protocol: "Liquid Staking",
    apy: "6.5%",
    action: "Zap USDC ➔ SOL",
    change24h: 3.1,
    spark: [30, 33, 32, 38, 41, 45, 44, 50],
  },
  {
    symbol: "LINK",
    name: "Chainlink",
    icon: "/tokens/link.png",
    protocol: "1inch Aqua Batch",
    apy: "5.2%",
    action: "Zap USDC ➔ LINK",
    change24h: -1.1,
    spark: [46, 45, 47, 44, 43, 45, 42, 41],
  },
];

// cuantas cards de la pila se muestran detras de la que esta activa
const VISIBLE_STACK_SIZE = 3;

export default function CardDeck({ onZap, onActiveTokenChange }: CardDeckProps) {
  // indice del token que esta arriba de la pila (el interactivo)
  const [currentIndex, setCurrentIndex] = useState(0);
  const swap = useSwapPosition();

  // El símbolo de la card de arriba; se lo pasamos al fondo reactivo del padre.
  const activeSymbol = STRATEGIES[currentIndex]?.symbol ?? null;
  useEffect(() => {
    onActiveTokenChange?.(activeSymbol);
  }, [activeSymbol, onActiveTokenChange]);

  async function handleSwipeRight(token: Token) {
    console.log(`Initiating 1inch SwapVM position for ${token.symbol}`);
    // La card ya salio volando: avanzamos la pila y compilamos en paralelo.
    setCurrentIndex((index) => index + 1);

    const result = await swap.openPosition({
      toToken: TOKEN_ADDRESSES[token.symbol] ?? WETH_ADDRESS,
    });

    if (result) {
      // El toast del padre pasa a ser el dueno del resultado; limpiamos el
      // overlay de "compilando" de la pila.
      onZap?.({ ...result, token });
      swap.reset();
    }
  }

  function handleSwipeLeft(token: Token) {
    console.log(`Skipped ${token.symbol}`);
    setCurrentIndex((index) => index + 1);
  }

  function handleSwipeComplete(direction: "left" | "right", token: Token) {
    if (direction === "right") {
      handleSwipeRight(token);
    } else {
      handleSwipeLeft(token);
    }
  }

  const visibleTokens = STRATEGIES.slice(
    currentIndex,
    currentIndex + VISIBLE_STACK_SIZE,
  );

  return (
    // Height tracks the viewport so short Telegram webviews (native bottom nav
    // eating vertical space) never clip the active card.
    <div className="relative h-[min(24rem,58vh)] w-full max-w-sm">
      {visibleTokens.length === 0 ? (
        <div className="glass-panel flex h-full w-full flex-col items-center justify-center gap-4 rounded-3xl border-white/10 px-6 text-center">
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-slate-100">
              You&rsquo;ve reviewed every strategy
            </p>
            <p className="text-xs text-slate-400">
              Reset the deck to swipe through them again.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              swap.reset();
              setCurrentIndex(0);
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-slate-100 shadow-lg shadow-black/20 backdrop-blur-md transition hover:border-emerald-400/40 hover:bg-emerald-500/10 hover:text-emerald-200"
          >
            <RotateCcw className="h-4 w-4" />
            Reset Deck
          </button>
        </div>
      ) : (
        visibleTokens.map((token, stackOffset) => (
          <SwipeCard
            key={token.symbol}
            token={token}
            active={stackOffset === 0}
            stackOffset={stackOffset}
            isCompiling={stackOffset === 0 && swap.isLoading}
            onSwipeComplete={handleSwipeComplete}
          />
        ))
      )}

      <AnimatePresence>
        {swap.isLoading && (
          <motion.div
            key="zap-compiling"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="glass-panel absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-3xl border-emerald-400/30 text-center"
          >
            {/* halo verde que respira mientras se compila el batch */}
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-3xl"
              animate={{
                boxShadow: [
                  "0 0 0px 0px rgba(16,185,129,0)",
                  "0 0 34px 6px rgba(16,185,129,0.45)",
                  "0 0 0px 0px rgba(16,185,129,0)",
                ],
              }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
            <Loader2 className="h-7 w-7 animate-spin text-emerald-300" />
            <p className="text-sm font-semibold text-emerald-200">
              Compiling SwapVM batch…
            </p>
            <p className="text-xs text-slate-400">
              1inch Aqua swap &rarr; Lido stake
            </p>
          </motion.div>
        )}

        {swap.error && (
          <motion.div
            key="zap-error"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="glass-panel absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-3xl border-red-400/30 px-6 text-center"
          >
            <p className="text-sm font-semibold text-red-300">
              Couldn&rsquo;t compile the swap
            </p>
            <p className="max-w-full break-words text-xs text-slate-400">
              {swap.error}
            </p>
            <button
              type="button"
              onClick={() => swap.reset()}
              className="mt-1 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
