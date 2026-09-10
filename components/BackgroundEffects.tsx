"use client";

/**
 * BackgroundEffects — the app's ambient atmosphere layer. Purely decorative:
 * `pointer-events-none`, no data logic, mounted behind every UI element.
 *
 *   - two soft blurred gradient orbs that slowly breathe (scale + opacity),
 *   - a central "spotlight" glow whose colour cross-fades to the token in
 *     focus on the deck,
 *   - a faint cyber dot-matrix grid across the viewport.
 *
 * All motion is transform/opacity only (compositor-friendly) and the two loops
 * are disabled under `prefers-reduced-motion`, so it holds 60fps on mobile.
 */

import { motion, useReducedMotion } from "framer-motion";

/** Central-glow colour per focused token (rgba so it can CSS-transition). */
const ETH_GLOW = "rgba(34, 211, 238, 0.16)"; // cyan → deep indigo
const BTC_GLOW = "rgba(245, 158, 11, 0.16)"; // warm gold / amber
const SOL_GLOW = "rgba(139, 92, 246, 0.17)"; // neon violet / emerald
const USDC_GLOW = "rgba(16, 185, 129, 0.16)"; // emerald / teal yield

const GLOW_BY_SYMBOL: Record<string, string> = {
  ETH: ETH_GLOW,
  WETH: ETH_GLOW,
  STETH: ETH_GLOW,
  LINK: ETH_GLOW,
  BTC: BTC_GLOW,
  WBTC: BTC_GLOW,
  SOL: SOL_GLOW,
  USDC: USDC_GLOW,
};
const DEFAULT_GLOW = ETH_GLOW;

function glowFor(symbol?: string | null): string {
  if (!symbol) return DEFAULT_GLOW;
  return GLOW_BY_SYMBOL[symbol.toUpperCase()] ?? DEFAULT_GLOW;
}

interface BackgroundEffectsProps {
  /** Symbol of the card currently on top of the deck. */
  symbol?: string | null;
}

export default function BackgroundEffects({ symbol }: BackgroundEffectsProps) {
  const reduceMotion = useReducedMotion();

  const breathe = reduceMotion
    ? undefined
    : { scale: [1, 1.15, 1], opacity: [0.3, 0.6, 0.3] };

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* Orb 1 — top left, cyan/indigo */}
      <motion.div
        className="absolute -left-20 -top-24 h-72 w-72 rounded-full bg-cyan-500/15 blur-[120px]"
        style={{ willChange: "transform, opacity" }}
        animate={breathe}
        transition={
          reduceMotion
            ? undefined
            : { duration: 9, repeat: Infinity, ease: "easeInOut" }
        }
      />

      {/* Orb 2 — bottom right, purple/emerald */}
      <motion.div
        className="absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-purple-600/15 blur-[140px]"
        style={{ willChange: "transform, opacity" }}
        animate={breathe}
        transition={
          reduceMotion
            ? undefined
            : {
                duration: 10,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 1.5,
              }
        }
      />

      {/* Central reactive spotlight — colour follows the focused token */}
      <div
        className="absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[130px] transition-colors duration-1000 ease-out"
        style={{ backgroundColor: glowFor(symbol) }}
      />

      {/* Cyber grid / dot-matrix texture — sits behind everything (z-0) */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(#334155_1px,transparent_1px)] opacity-20 [background-size:24px_24px]" />
    </div>
  );
}
