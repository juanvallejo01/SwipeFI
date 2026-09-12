"use client";

/**
 * Thin wrapper around Privy's `usePrivy()` / `useWallets()` / `useLogin()` that
 * surfaces just what the UI needs: the Telegram/social user's EVM embedded
 * wallet address, auth state, and a `login()` trigger.
 *
 * Only call this from a component that is guaranteed to render inside
 * `<PrivyProvider>` — i.e. one mounted conditionally on the same
 * `PRIVY_APP_ID` check `app/providers.tsx` uses to decide whether to mount the
 * provider at all. Calling any Privy hook outside that provider throws, so
 * this hook does not itself guard against a missing app id.
 */

import { useCallback } from "react";
import {
  getEmbeddedConnectedWallet,
  useLogin,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";

export interface PrivyEmbeddedWallet {
  /** True once Privy has finished restoring/initializing the client session. */
  ready: boolean;
  /** True once the Telegram/social user has authenticated with Privy. */
  authenticated: boolean;
  /** The user's EVM embedded wallet address, or `null` until one exists. */
  address: string | null;
  /** Opens Privy's login flow (email / social / Telegram-linked wallet). */
  login: () => void;
}

export function usePrivyEmbeddedWallet(): PrivyEmbeddedWallet {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const { login } = useLogin();

  const embedded = getEmbeddedConnectedWallet(wallets);

  return {
    ready,
    authenticated,
    address: embedded?.address ?? null,
    login: useCallback(() => login(), [login]),
  };
}

export default usePrivyEmbeddedWallet;
