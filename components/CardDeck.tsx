"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import SwipeCard from "@/components/SwipeCard";
import {
  useSwapPosition,
  WETH_ADDRESS,
  type SwapPositionResult,
} from "@/hooks/useSwapPosition";

export interface Token {
  symbol: string;
  name: string;
  logo: string;
  change24h: number;
  apy: number;
  aiTag: string;
}

/** A compiled Zap & Yield position, tagged with the card that produced it. */
export interface ZapResult extends SwapPositionResult {
  token: Token;
}

interface CardDeckProps {
  /** Called once `/api/swap` returns the compiled SwapVM batch for a swipe-right. */
  onZap?: (result: ZapResult) => void;
}

// Mainnet ERC-20 addresses for the swap leg of the Zap & Yield flow. The atomic
// batch always stakes the swapped-out ETH into Lido for stETH; this map only
// picks which token 1inch Aqua routes the USDC through first.
const TOKEN_ADDRESSES: Record<string, string> = {
  ETH: WETH_ADDRESS,
  LINK: "0x514910771AF9Ca656af840dff83E8264EcF986CA",
  UNI: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
};

// dataset simulado: en Day 3 esto vendra de un feed real de precios/APY
const MOCK_TOKENS: Token[] = [
  {
    symbol: "ETH",
    name: "Ethereum",
    logo: "🔷",
    change24h: 2.4,
    apy: 4.8,
    aiTag: "Strong momentum this week",
  },
  {
    symbol: "LINK",
    name: "Chainlink",
    logo: "🔗",
    change24h: -1.1,
    apy: 6.2,
    aiTag: "Oracle demand rising",
  },
  {
    symbol: "UNI",
    name: "Uniswap",
    logo: "🦄",
    change24h: 0.8,
    apy: 5.5,
    aiTag: "DEX volume trending up",
  },
];

// cuantas cards de la pila se muestran detras de la que esta activa
const VISIBLE_STACK_SIZE = 3;

export default function CardDeck({ onZap }: CardDeckProps) {
  // indice del token que esta arriba de la pila (el interactivo)
  const [currentIndex, setCurrentIndex] = useState(0);
  const swap = useSwapPosition();

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

  const visibleTokens = MOCK_TOKENS.slice(
    currentIndex,
    currentIndex + VISIBLE_STACK_SIZE,
  );

  return (
    <div className="relative h-96 w-full max-w-sm">
      {visibleTokens.length === 0 ? (
        <div className="glass-panel flex h-full w-full items-center justify-center rounded-3xl border-white/10 px-6 text-center text-sm text-slate-400">
          No more tokens to review — check back later.
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
