"use client";

import { useState } from "react";
import CardDeck, { type ZapResult } from "@/components/CardDeck";
import TransactionToast from "@/components/TransactionToast";
import TransactionTerminal from "@/components/TransactionTerminal";
import ErrorBoundary from "@/components/ErrorBoundary";
import BackgroundEffects from "@/components/BackgroundEffects";
import { useActiveWallet } from "@/hooks/useSwapPosition";

/** "0xabc…1234" */
function shortAddress(address: string): string {
  return address.length < 10
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function Home() {
  // Última posición Zap & Yield compilada. Alimenta el terminal (persistente
  // hasta que el usuario lo cierra) y el toast (transitorio, se auto-descarta).
  const [zap, setZap] = useState<ZapResult | null>(null);
  const [toastOpen, setToastOpen] = useState(false);

  // Wallet activa: provider inyectado / Telegram WebApp, o la cuenta demo.
  const wallet = useActiveWallet();

  // Símbolo de la card de arriba — tiñe el glow ambiental del fondo.
  const [activeSymbol, setActiveSymbol] = useState<string | null>("ETH");

  function handleZap(result: ZapResult) {
    setZap(result);
    setToastOpen(true);
  }

  return (
    <>
      {/* Decorative ambient atmosphere — behind every UI element, no logic. */}
      <BackgroundEffects symbol={activeSymbol} />

      <div className="relative z-10 flex flex-1 flex-col items-center gap-6 px-6 py-10 text-center">
        <div className="glass-panel flex max-w-sm flex-col gap-3 rounded-3xl px-6 py-8">
          <h2 className="text-2xl font-bold text-slate-50">SwipeFi</h2>
          <p className="text-sm text-slate-400">
            Zap your USDC into stETH yield with a single swipe, powered by 1inch
            Aqua SwapVM.
          </p>
        </div>

        {/* Wallet status — subtle demo badge until a real wallet is attached;
            prefixed with the Telegram @username when opened inside Telegram. */}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] font-medium ${
            wallet.isDemo
              ? "border-amber-400/25 bg-amber-500/10 text-amber-200/90"
              : "border-emerald-400/25 bg-emerald-500/10 text-emerald-200/90"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              wallet.isDemo ? "bg-amber-400" : "bg-emerald-400"
            }`}
          />
          {wallet.telegramUser ? `${wallet.telegramUser} · ` : ""}
          {wallet.isDemo
            ? `Demo Wallet Active · ${shortAddress(wallet.address)}`
            : `Wallet connected · ${shortAddress(wallet.address)}`}
        </span>

        {/* Any unexpected Web3 / execution throw inside the deck or terminal is
            caught here instead of crashing the Telegram webview. */}
        <ErrorBoundary onRetry={() => setZap(null)}>
          <CardDeck onZap={handleZap} onActiveTokenChange={setActiveSymbol} />

          <TransactionTerminal
            result={zap}
            onClose={() => setZap(null)}
            onExpandedChange={(open) => {
              // Terminal and toast never share the screen.
              if (open) setToastOpen(false);
            }}
          />
        </ErrorBoundary>

        <TransactionToast
          open={toastOpen}
          result={zap}
          onDismiss={() => setToastOpen(false)}
        />
      </div>
    </>
  );
}
