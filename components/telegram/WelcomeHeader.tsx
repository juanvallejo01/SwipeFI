"use client";

import { useEffect, useSyncExternalStore } from "react";

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
      <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
    </header>
  );
}
