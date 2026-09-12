"use client";

import { useId, useState } from "react";
import Image from "next/image";
import {
  motion,
  useAnimation,
  useMotionValue,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { Token } from "@/components/CardDeck";

// mas alla de estos px en X, el swipe cuenta como decision (skip / zap)
const SWIPE_THRESHOLD = 120;
// un flick rapido cuenta como swipe aunque no llegue al umbral de distancia
// — info.velocity esta en px/ms, asi que 0.5 equivale a ~500px/s
const SWIPE_VELOCITY_THRESHOLD = 0.5;
// que tan lejos vuela la card fuera de pantalla al ser descartada
const EXIT_DISTANCE = 500;

// Brand colours (Viem token palette) — drive the ambient glow and the CSS
// fallback badge when the local asset fails to load.
const TOKEN_BRAND: Record<string, string> = {
  ETH: "#627EEA",
  WETH: "#627EEA",
  USDC: "#2775CA",
  BTC: "#F7931A",
  WBTC: "#F7931A",
  SOL: "#14F195",
  LINK: "#2A5ADA",
  AAVE: "#B6509E",
  LIDO: "#00A3FF",
};
const DEFAULT_BRAND = "#64748B";

/** "#627EEA" → "rgba(98,126,234,<alpha>)". */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Neon glowing 7-day trend sparkline. Deterministic SVG path from `data`
 * (oldest → newest), with a gradient fill under the curve and a pulsing
 * end-point.
 */
function Sparkline({
  data,
  className,
}: {
  data: number[];
  className?: string;
}) {
  const gid = useId();
  const w = 120;
  const h = 36;
  const pad = 3;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });

  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const [lastX, lastY] = pts[pts.length - 1];
  const area = `${line} L${lastX.toFixed(1)},${h} L${pts[0][0].toFixed(
    1
  )},${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(52,211,153)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(52,211,153)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]"
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="2.5"
        className="fill-emerald-300 drop-shadow-[0_0_6px_rgba(52,211,153,0.9)]"
      >
        <animate
          attributeName="opacity"
          values="1;0.3;1"
          dur="1.8s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  );
}

/**
 * Levitating token mark: a Framer-Motion floating container, a cyan→indigo
 * gradient aura, and the local asset inside a glass tile. Falls back to a crisp
 * brand-coloured symbol badge if the asset fails to load.
 */
function FloatingTokenIcon({ token }: { token: Token }) {
  const [imgFailed, setImgFailed] = useState(false);
  const brand = TOKEN_BRAND[token.symbol.toUpperCase()] ?? DEFAULT_BRAND;

  return (
    <motion.div
      className="relative flex h-14 w-14 shrink-0 items-center justify-center"
      animate={{ y: [-4, 4, -4], rotateZ: [-2, 2, -2] }}
      transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
    >
      {/* glowing gradient aura */}
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-2 rounded-full bg-gradient-to-tr from-cyan-500/20 to-indigo-500/20 blur-xl"
      />

      <div
        className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md"
        style={{ boxShadow: `0 0 25px ${hexToRgba(brand, 0.3)}` }}
      >
        {imgFailed ? (
          <span
            className="flex h-full w-full items-center justify-center rounded-2xl text-[13px] font-black tracking-tight text-white"
            style={{
              background: `linear-gradient(135deg, ${brand}, ${hexToRgba(
                brand,
                0.65
              )})`,
            }}
          >
            {token.symbol.slice(0, 4)}
          </span>
        ) : (
          <Image
            src={token.icon}
            alt={`${token.name} icon`}
            width={40}
            height={40}
            className="relative h-10 w-10 object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
            onError={() => setImgFailed(true)}
            unoptimized
          />
        )}
      </div>
    </motion.div>
  );
}

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
  // halo verde: aparece pasados +30px de arrastre a la derecha
  const rightGlowOpacity = useTransform(x, [30, 150], [0, 0.55]);
  // halo rojo: aparece pasados -30px de arrastre a la izquierda
  const leftGlowOpacity = useTransform(x, [-150, -30], [0.55, 0]);

  function handleDragEnd(
    _event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) {
    // Distancia arrastrada O velocidad del flick — en touch un swipe rapido
    // suele recorrer menos distancia que uno lento, y sin esto se sentia
    // como que la card "no respondia" a gestos rapidos en el celular.
    const passedThreshold =
      Math.abs(info.offset.x) > SWIPE_THRESHOLD ||
      Math.abs(info.velocity.x) > SWIPE_VELOCITY_THRESHOLD;
    if (!passedThreshold) {
      // no llego al umbral: dragConstraints la regresa sola al centro con spring
      return;
    }

    // Un flick corto puede terminar con offset ~0 — cae al signo de la
    // velocidad para no confundir la direccion en ese caso.
    const direction =
      (info.offset.x !== 0 ? info.offset.x : info.velocity.x) > 0
        ? "right"
        : "left";
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
      style={{
        x,
        rotate,
        zIndex: 10 - stackOffset,
        willChange: "transform",
        // deja que el navegador maneje el scroll vertical nativo y solo
        // intercepte el gesto horizontal — sin esto, en touch (Telegram
        // webview incluido) el drag compite con el scroll de la pagina y
        // se siente entrecortado
        touchAction: active ? "pan-y" : undefined,
        cursor: active && !isExiting ? "grab" : undefined,
      }}
      drag={active && !isExiting ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      // dragConstraints colapsa a un solo punto, asi que TODO el arrastre
      // cae en la zona "elastica" — con el default (0.5) la card se movia a
      // la mitad de la velocidad del dedo y se sentia pesada/entrecortada en
      // touch. dragElastic={1} hace que siga el dedo 1:1.
      dragElastic={1}
      // resorte de regreso al centro alineado con el resto de las
      // transiciones de la card (300/30) — el default de Framer (500/10)
      // es mucho mas rebotón y se siente inconsistente con el resto
      dragTransition={{ bounceStiffness: 300, bounceDamping: 30 }}
      whileTap={active && !isExiting ? { cursor: "grabbing" } : undefined}
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
          {/* Halo de arrastre: verde a la derecha, rojo a la izquierda — solo
              se nota pasados los ±30px que marca el requisito. */}
          <motion.span
            aria-hidden
            style={{ opacity: rightGlowOpacity }}
            className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-br from-emerald-500/25 via-emerald-400/10 to-transparent"
          />
          <motion.span
            aria-hidden
            style={{ opacity: leftGlowOpacity }}
            className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-bl from-rose-500/25 via-rose-400/10 to-transparent"
          />
        </>
      )}

      {/* Header — icon + a single flex column so symbol / protocol / source
          never collide, even while cards are stacked. */}
      <div className="flex items-center gap-3">
        <FloatingTokenIcon token={token} />
        {active && (
          <div className="flex flex-col gap-1 leading-tight">
            <h3 className="text-xl font-bold text-slate-50">{token.symbol}</h3>
            <p className="text-sm text-slate-300">{token.protocol}</p>
            <p className="text-xs text-slate-500">via 1inch Aqua</p>
          </div>
        )}
      </div>

      {/* Detail — only on the top card; the stack behind stays a clean blur. */}
      {active && (
        <div className="flex flex-col gap-3">
          <Sparkline data={token.spark} className="h-9 w-full" />

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">7-day trend</span>
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
            <span className="font-semibold text-emerald-300">{token.apy}</span>
          </div>

          <span className="flex w-fit items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
            {token.yieldIcon && (
              <Image
                src={token.yieldIcon}
                alt=""
                width={14}
                height={14}
                className="h-3.5 w-3.5 object-contain"
                unoptimized
              />
            )}
            {token.action}
          </span>
        </div>
      )}
    </motion.div>
  );
}
