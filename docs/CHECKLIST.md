# SwipeFi — ETHGlobal Submission Checklist

Pre-submission audit for the 1inch Aqua track. Run through this top to bottom
before the code-freeze deadline. Nothing here is automated — check each item
by hand and tick it off.

## 1. Vercel production deployment

- [ ] `vercel --prod` (or the Vercel dashboard) shows the latest `main` commit
      deployed, not a stale build. No local `.vercel/` project link was found
      in this repo as of this checklist's writing — confirm the project is
      actually linked to Vercel before assuming a deploy exists.
- [ ] `GET /` loads the swipe deck without a client-side error overlay
      (`ErrorBoundary` catching a render crash).
- [ ] `POST /api/swap` on the **production** URL returns `200` for a valid
      body (see `app/api/swap/route.ts`'s `GET` handler for `exampleBody`),
      not a `500` — a 500 here means `ONEINCH_API_KEY` or `ETH_RPC_URL` is
      missing in the Vercel project's environment variables (see §2).
- [ ] The Transaction Terminal's network pill (`detectNetwork()` in
      `components/TransactionTerminal.tsx`) reads **"Ethereum Mainnet"** on
      prod, not "Mainnet Fork / Hardhat Local" — this requires
      `NEXT_PUBLIC_VERCEL_ENV=production` (or `preview`) **and**
      `NEXT_PUBLIC_ETH_RPC_URL` set to the same host as `ETH_RPC_URL`.

## 2. Environment variables

Server-side (`lib/aqua/compileSwap.ts` → `resolveSwapEnv()` throws
`SwapConfigError` / HTTP 500 if either is missing):

- [ ] `ONEINCH_API_KEY` is set in Vercel. **Not currently documented in
      `.env.example`** — add it there so the next person configuring the
      project doesn't hit a silent 500. Locally, set it in `.env`.
- [ ] `ETH_RPC_URL` is set, archive-capable (mainnet state must be
      forkable/queryable at arbitrary block heights), and matches the network
      Hardhat forks (`hardhat.config.ts` reads this same variable).

Client-visible, optional (inlined at build time, no secrets — see
`.env.example`):

- [ ] `NEXT_PUBLIC_VERCEL_ENV` set to `production` in the Vercel project (so
      the Transaction Terminal's live/fork network label is correct).
- [ ] `NEXT_PUBLIC_ETH_RPC_URL` set to the same provider host as
      `ETH_RPC_URL` (only the hostname is matched against known providers —
      infura/alchemy/quicknode/ankr/llamarpc/etc).

Optional overrides worth double-checking aren't left at placeholder values:
`AQUA_CONTRACT_ADDRESS`, `SWAPVM_ROUTER_ADDRESS`, `AQUA_APP_ADDRESS`,
`AQUA_MAKER_ADDRESS`, `AQUA_STRATEGY_SALT`, `LIDO_STETH_ADDRESS`,
`LIDO_REFERRAL_ADDRESS`, `LIDO_APY_ESTIMATE`.

## 3. Telegram `@BotFather` WebApp configuration

- [ ] The Mini App's WebApp URL (set via `@BotFather` → `/newapp` or
      `/setmenubutton`) points at the **production Vercel URL**, not
      `localhost` — a `localhost` URL will not resolve for anyone opening the
      bot on their phone.
- [ ] The URL is `https://` — Telegram refuses non-HTTPS WebApp URLs.
- [ ] Opening the bot in Telegram renders `components/telegram/WelcomeHeader.tsx`
      with `isTelegramEnv: true` and the real Telegram first name (confirms
      `window.Telegram.WebApp` is actually injected, i.e. the page is being
      loaded inside Telegram's WebView and not just a browser hitting the same
      URL).
- [ ] Swiping a card inside the real Telegram client successfully round-trips
      to `/api/swap` and the Transaction Terminal opens (not just in desktop
      Chrome — Telegram's in-app browser can behave differently).

## 4. Local Mainnet Fork setup script verification

- [ ] `npx hardhat node` starts cleanly with the configured `ETH_RPC_URL` and
      logs the forked block height (no `[hardhat] ETH_RPC_URL is not set`
      warning from `hardhat.config.ts`).
- [ ] `npx hardhat run scripts/setupFork.ts` (or `npm run fork:setup`)
      completes without throwing — specifically the whale-balance check:
      if the pinned/latest fork block is too far from when
      `USDC_WHALE` (`0x28C6c06298d514Db089934071355E5743bf21d60`, Binance 14)
      held ≥5,000 USDC, the script throws and a `blockNumber` needs pinning in
      `hardhat.config.ts`.
- [ ] The script's final balance log shows the test account
      (`0xf39Fd6...92266`, Hardhat/Anvil account #0) holding **10 ETH** and
      **5,000 USDC**.
- [ ] `npm run test:swap` passes all direct (offline) checks.
- [ ] `npm run test:swap -- --http` passes against a `npm run dev` instance
      pointed at the fork — confirms the full request path, not just the
      compiler in isolation.
