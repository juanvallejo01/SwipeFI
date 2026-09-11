"use client";

/**
 * LoadingScreen — full-viewport branded splash shown while the Telegram
 * WebApp boots and the deck hydrates, so the UI never pops in abruptly.
 *
 * Purely presentational: `app/page.tsx` owns the actual `isLoading` timing
 * (an artificial minimum display window combined with
 * `window.Telegram?.WebApp?.ready()`) and passes it down as `visible`. Kept
 * as a dumb `visible` prop rather than owning a timer itself so the splash
 * stays trivially SSR-safe — no `window` access here.
 *
 * `pointer-events-none` is applied the instant `visible` flips to `false`,
 * not only once the exit animation finishes — otherwise the ~0.5s fade-out
 * would still swallow the first tap on the UI revealed underneath.
 */

import { AnimatePresence, motion } from "framer-motion";

interface LoadingScreenProps {
  visible: boolean;
}

export default function LoadingScreen({ visible }: LoadingScreenProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="loading-screen"
          role="status"
          aria-live="polite"
          aria-label="Loading SwipeFi"
          exit={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-slate-950 ${
            visible ? "" : "pointer-events-none"
          }`}
        >
          {/* Ambient pulsing glow behind the spinner */}
          <div className="relative flex h-40 w-40 items-center justify-center">
            <motion.span
              aria-hidden
              className="absolute h-40 w-40 rounded-full bg-cyan-500/20 blur-2xl"
              animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.9, 0.5] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.span
              aria-hidden
              className="h-12 w-12 rounded-full border-2 border-slate-700 border-t-cyan-400"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
            />
          </div>

          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              SwipeFi
            </h1>
            <p className="text-xs font-medium text-slate-500">
              Powered by 1inch Aqua SwapVM
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
