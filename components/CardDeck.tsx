"use client";

import { useState } from "react";
import SwipeCard from "@/components/SwipeCard";

export interface Token {
  symbol: string;
  name: string;
  logo: string;
  change24h: number;
  apy: number;
  aiTag: string;
}

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

export default function CardDeck() {
  // indice del token que esta arriba de la pila (el interactivo)
  const [currentIndex, setCurrentIndex] = useState(0);

  function handleSwipeRight(token: Token) {
    console.log(`Initiating 1inch SwapVM position for ${token.symbol}`);
    setCurrentIndex((index) => index + 1);
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

  if (visibleTokens.length === 0) {
    return (
      <div className="glass-panel flex h-96 w-full max-w-sm items-center justify-center rounded-3xl border-white/10 px-6 text-center text-sm text-slate-400">
        No more tokens to review — check back later.
      </div>
    );
  }

  return (
    <div className="relative h-96 w-full max-w-sm">
      {visibleTokens.map((token, stackOffset) => (
        <SwipeCard
          key={token.symbol}
          token={token}
          active={stackOffset === 0}
          stackOffset={stackOffset}
          onSwipeComplete={handleSwipeComplete}
        />
      ))}
    </div>
  );
}
