"use client";

import { useEffect, useState } from "react";
import CardDeck, { type ZapResult } from "@/components/CardDeck";
import TransactionToast from "@/components/TransactionToast";
import TransactionTerminal from "@/components/TransactionTerminal";
import ErrorBoundary from "@/components/ErrorBoundary";
import BackgroundEffects from "@/components/BackgroundEffects";
import LoadingScreen from "@/components/LoadingScreen";
import { useActiveWallet } from "@/hooks/useSwapPosition";

/** Splash stays up at least this long so it never flickers on fast networks. */
const MIN_SPLASH_MS = 1_000;

/** "0xabc…1234" */
function shortAddress(address: string): string {
  return address.length < 10
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function Home() {
  // Splash overlay. Stays true for at least MIN_SPLASH_MS so the deck never
  // pops in mid-hydration; window.Telegram?.WebApp?.ready() dismisses
  // Telegram's own native loading indicator in parallel.
  const [isLoading, setIsLoading] = useState(true);

  // Última posición Zap & Yield compilada. Alimenta el terminal (persistente
  // hasta que el usuario lo cierra) y el toast (transitorio, se auto-descarta).
  const [zap, setZap] = useState<ZapResult | null>(null);
  const [toastOpen, setToastOpen] = useState(false);

  // Wallet activa: provider inyectado / Telegram WebApp, o la cuenta demo.
  const wallet = useActiveWallet();

  // Símbolo de la card de arriba — tiñe el glow ambiental del fondo.
  const [activeSymbol, setActiveSymbol] = useState<string | null>("ETH");

  useEffect(() => {
    window.Telegram?.WebApp?.ready();

    const timer = window.setTimeout(() => setIsLoading(false), MIN_SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);

  function handleZap(result: ZapResult) {
    setZap(result);
    setToastOpen(true);
  }

  return (
    <>
      <LoadingScreen visible={isLoading} />

      {/* Decorative ambient atmosphere — behind every UI element, no logic. */}
      <BackgroundEffects symbol={activeSymbol} />

      <div className="relative z-10 flex flex-1 flex-col items-center gap-6 px-6 py-10 text-center">
        {/* Sticky header: pinned above the deck so dragged/exiting cards never
            render on top of the brand + wallet status while scrolling. */}
        <div className="sticky top-0 z-30 -mx-6 flex w-[calc(100%+3rem)] flex-col items-center gap-6 border-b border-slate-800/50 bg-slate-950/80 px-6 pb-6 pt-2 backdrop-blur-md">
          <div className="glass-panel flex max-w-sm flex-col gap-3 rounded-3xl px-6 py-8">
            <h2 className="text-2xl font-bold text-slate-50">
              Swipe Into Yield
            </h2>
            <p className="text-sm text-slate-400">
              Zap stablecoins into yield protocols in 1 swipe — powered by 1inch
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
        </div>

        {/* Card deck sits strictly below the sticky header's stacking
            context — isolate keeps its own z-index scale from ever competing
            with the header's, overflow-hidden clips any stray drag/exit
            transform at this section's own bounds. */}
        <div className="relative z-10 isolate w-full flex-1 overflow-hidden">
          {/* Any unexpected Web3 / execution throw inside the deck or terminal is
              caught here instead of crashing the Telegram webview. */}
          <ErrorBoundary onRetry={() => setZap(null)}>
            <div className="flex flex-col items-center gap-6">
              <CardDeck
                onZap={handleZap}
                onActiveTokenChange={setActiveSymbol}
              />

              <TransactionTerminal
                result={zap}
                onClose={() => setZap(null)}
                onExpandedChange={(open) => {
                  // Terminal and toast never share the screen.
                  if (open) setToastOpen(false);
                }}
              />
            </div>
          </ErrorBoundary>
        </div>

        <TransactionToast
          open={toastOpen}
          result={zap}
          onDismiss={() => setToastOpen(false)}
        />
      </div>
    </>
  );
}
