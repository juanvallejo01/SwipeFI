"use client";

import { useEffect, useSyncExternalStore } from "react";
import { PRIVY_APP_ID } from "@/app/providers";
import usePrivyEmbeddedWallet from "@/hooks/usePrivyEmbeddedWallet";

/** "0xabc…1234" */
function shortAddress(address: string): string {
  return address.length < 10
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface TelegramSession {
  isTelegramEnv: boolean;
  firstName: string | null;
}

const SERVER_SESSION: TelegramSession = {
  isTelegramEnv: false,
  firstName: null,
};

// The Telegram WebApp global is injected by telegram-web-app.js and never
// changes after load, so this store never notifies subscribers — it only
// exists to read a browser-only global without a server/client mismatch.
function subscribe() {
  return () => {};
}

function getSnapshot(): TelegramSession {
  if (typeof window === "undefined" || !window.Telegram?.WebApp) {
    return SERVER_SESSION;
  }

  return {
    isTelegramEnv: true,
    firstName: window.Telegram.WebApp.initDataUnsafe.user?.first_name ?? null,
  };
}

function getServerSnapshot(): TelegramSession {
  return SERVER_SESSION;
}

/**
 * Embedded-wallet pill — only mounted when `PRIVY_APP_ID` is set, so it is
 * guaranteed to render inside `<PrivyProvider>` (see app/providers.tsx).
 * Auto-triggers Privy login the moment it detects a Telegram session with no
 * authenticated wallet yet, so the user gets an EVM embedded wallet without
 * hunting for a "connect" button.
 */
function EmbeddedWalletPill({ isTelegramEnv }: { isTelegramEnv: boolean }) {
  const { ready, authenticated, address, login } = usePrivyEmbeddedWallet();

  useEffect(() => {
    if (isTelegramEnv && ready && !authenticated) login();
  }, [isTelegramEnv, ready, authenticated, login]);

  if (!ready) return null;

  if (authenticated && address) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] font-medium text-emerald-200/90">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        {shortAddress(address)}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={login}
      className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:border-emerald-400/40 hover:bg-emerald-500/10 hover:text-emerald-200"
    >
      Connect Wallet
    </button>
  );
}

export default function WelcomeHeader() {
  const session = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!session.isTelegramEnv) return;

    // @twa-dev/sdk touches `window` at module scope, so it must only be
    // loaded client-side (a static import would break server rendering).
    import("@twa-dev/sdk").then(({ default: WebApp }) => {
      WebApp.ready();
      WebApp.expand();
      WebApp.setHeaderColor("#020617");
      WebApp.setBackgroundColor("#020617");
    });
  }, [session.isTelegramEnv]);

  const greetingName = session.firstName ?? "there";

  return (
    <header className="glass-panel sticky top-0 z-10 flex items-center justify-between rounded-b-2xl px-5 py-4">
      <div>
        <p className="text-xs uppercase tracking-widest text-slate-400">
          {session.isTelegramEnv ? "Telegram Mini App" : "Preview mode"}
        </p>
        <h1 className="text-lg font-semibold text-slate-50">
          Hey, {greetingName}
        </h1>
      </div>

      {/* Privy is optional — skip entirely (no throw) when the app id isn't
          configured, e.g. a fork or CI build without a Privy project set up. */}
      {PRIVY_APP_ID ? (
        <EmbeddedWalletPill isTelegramEnv={session.isTelegramEnv} />
      ) : (
        <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
      )}
    </header>
  );
}
