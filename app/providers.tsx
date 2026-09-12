"use client";

/**
 * Privy provider setup for Day 9 — Telegram Embedded Wallet creation + real
 * transaction signing.
 *
 * `NEXT_PUBLIC_PRIVY_APP_ID` is a `NEXT_PUBLIC_*` var, so Next.js inlines its
 * value at build time: every module that reads it sees the same literal
 * (string or `undefined`) for the lifetime of a given build/deploy. That lets
 * every consumer (`WelcomeHeader`, `TransactionTerminal`) check the same
 * exported `PRIVY_APP_ID` constant to decide whether Privy hooks are safe to
 * call, instead of introducing a second layer of context.
 *
 * When the app id is missing (no Privy project configured yet, or a fork/CI
 * build that never set it), `Providers` renders `children` untouched — no
 * `<PrivyProvider>`, no thrown error — so the rest of the app keeps working
 * exactly as it did before Day 9 (demo wallet, offline-compiled terminal).
 */

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { hardhat, mainnet } from "viem/chains";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  if (!PRIVY_APP_ID) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#34d399",
          walletChainType: "ethereum-only",
        },
        // Mainnet for the real Zap & Yield route; the local Hardhat fork
        // (chain 31337) so the same flow works against `fork:setup`.
        defaultChain: mainnet,
        supportedChains: [mainnet, hardhat],
        embeddedWallets: {
          // Auto-create an embedded EVM wallet for Telegram/social logins
          // that don't already have one attached (e.g. an injected wallet).
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
