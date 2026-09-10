"use client";

import { useState } from "react";
import {
  motion,
  useAnimation,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { TrendingDown, TrendingUp, X, Zap } from "lucide-react";
import type { Token } from "@/components/CardDeck";

// mas alla de estos px en X, el swipe cuenta como decision (skip / zap)
const SWIPE_THRESHOLD = 150;
// que tan lejos vuela la card fuera de pantalla al ser descartada
const EXIT_DISTANCE = 500;

interface SwipeCardProps {
  token: Token;
  active: boolean;
  stackOffset: number;
  /** True while `/api/swap` is compiling this card's Zap & Yield batch. */
  isCompiling?: boolean;
  onSwipeComplete: (direction: "left" | "right", token: Token) => void;
}

export default function SwipeCard({
  token,
  active,
  stackOffset,
  isCompiling = false,
  onSwipeComplete,
}: SwipeCardProps) {
  const [isExiting, setIsExiting] = useState(false);
  const controls = useAnimation();

  // posicion horizontal de arrastre; todo lo demas (rotacion, overlays) depende de este valor
  const x = useMotionValue(0);
  // rotacion dinamica: entre mas se arrastra a un lado, mas se inclina la card
  const rotate = useTransform(x, [-300, 300], [-20, 20]);
  // opacidad de la etiqueta verde "ZAP & YIELD" al arrastrar a la derecha
  const zapOpacity = useTransform(x, [0, SWIPE_THRESHOLD], [0, 1]);
  // opacidad de la etiqueta roja "SKIP" al arrastrar a la izquierda
  const skipOpacity = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0]);

  function handleDragEnd(
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) {
    const passedThreshold = Math.abs(info.offset.x) > SWIPE_THRESHOLD;
    if (!passedThreshold) {
      // no llego al umbral: dragConstraints la regresa sola al centro con spring
      return;
    }

    const direction = info.offset.x > 0 ? "right" : "left";
    setIsExiting(true);

    // saca la card volando de la pantalla con fisica de resorte antes de avisar al padre
    controls
      .start({
        x: direction === "right" ? EXIT_DISTANCE : -EXIT_DISTANCE,
        opacity: 0,
        transition: { type: "spring", stiffness: 200, damping: 25 },
      })
      .then(() => onSwipeComplete(direction, token));
  }

  const isPositive = token.change24h >= 0;

  return (
    <motion.div
      className="glass-panel absolute inset-0 flex flex-col justify-between rounded-3xl border-white/10 p-6"
      style={{ x, rotate, zIndex: 10 - stackOffset }}
      drag={active && !isExiting ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
      animate={
        isExiting
          ? controls
          : { scale: 1 - stackOffset * 0.05, y: stackOffset * 14, opacity: 1 }
      }
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      {isCompiling && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-3xl border border-emerald-400/50"
          animate={{
            boxShadow: [
              "0 0 0px 0px rgba(16,185,129,0)",
              "0 0 28px 4px rgba(16,185,129,0.5)",
              "0 0 0px 0px rgba(16,185,129,0)",
            ],
          }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {active && (
        <>
          <motion.span
            style={{ opacity: zapOpacity }}
            className="pointer-events-none absolute right-6 top-6 flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-300"
          >
            <Zap className="h-3.5 w-3.5" /> Zap &amp; Yield
          </motion.span>
          <motion.span
            style={{ opacity: skipOpacity }}
            className="pointer-events-none absolute left-6 top-6 flex items-center gap-1 rounded-full border border-red-400/40 bg-red-500/20 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-300"
          >
            <X className="h-3.5 w-3.5" /> Skip
          </motion.span>
        </>
      )}

      <div className="flex items-center gap-3">
        <span className="text-4xl">{token.logo}</span>
        <div>
          <h3 className="text-xl font-bold text-slate-50">{token.symbol}</h3>
          <p className="text-sm text-slate-400">{token.name}</p>
        </div>
      </div>

      {/* el detalle solo se muestra en la card de arriba: las de atras son opacas
          por el glassmorphism, y mostrar texto completo ahi se ve superpuesto */}
      {active && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">24h</span>
            <span
              className={`flex items-center gap-1 font-semibold ${
                isPositive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {isPositive ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              {isPositive ? "+" : ""}
              {token.change24h}%
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Est. APY</span>
            <span className="font-semibold text-slate-50">{token.apy}%</span>
          </div>
          <span className="w-fit rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
            {token.aiTag}
          </span>
        </div>
      )}
    </motion.div>
  );
}
