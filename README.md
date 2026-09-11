# SwipeFi

**One-swipe atomic DeFi yield on Telegram, powered by 1inch Aqua SwapVM.**

Built for the ETHGlobal 1inch Aqua track (SwapVM). A Telegram Mini App that
turns "swap, approve, deposit" into a single swipe.

---

## Problem & Solution

Getting from idle stablecoins to a yield-bearing position is a multi-transaction
slog: approve a spender, swap into the intermediate asset, wait for
confirmation, then submit a second transaction into the yield protocol — each
one a separate signature, a separate wait, a separate chance to bail out of a
wallet UI that was never designed for a phone screen.

SwipeFi collapses that into one gesture. The user swipes right on a token
card inside a Telegram Mini App; the client sends the intent to
[`POST /api/swap`](app/api/swap/route.ts); the server compiles a single piece
of **1inch Aqua SwapVM** calldata that swaps USDC → ETH through Aqua liquidity
and stakes the output straight into Lido — atomically, in one transaction. If
either leg would fail, the whole batch reverts. There is no intermediate state
where the user's funds are swapped but not staked.

## 1inch Aqua Track Integration

### `@1inch/aqua-sdk` and SwapVM compilation

[`lib/aqua/compileSwap.ts`](lib/aqua/compileSwap.ts) is the SwapVM compiler at
the center of the project. It is pure and framework-free (no Next.js imports),
so it is unit-testable from a plain Node process — see
[`scripts/testSwapRoute.ts`](scripts/testSwapRoute.ts).

- **Protocol wiring** — `AquaProtocolContract`, `AQUA_CONTRACT_ADDRESSES`,
  `Address`, and `HexString` come straight from `@1inch/aqua-sdk`. The
  compiler builds an `AquaProtocolContract` instance against the canonical
  mainnet Aqua contract and calls `.ship(...)` to construct the maker-side
  liquidity-provisioning transaction (`meta.aqua.shipCalldata`) — this proves
  the SDK is wired end-to-end, not just imported for its types.
- **Strategy hashing** — the taker-side leg trades against a reference
  `XYCSwap` (constant-product) strategy. The compiler ABI-encodes the
  `{ maker, token0, token1, feeBps, salt }` tuple and runs it through
  `AquaProtocolContract.calculateStrategyHash(...)` from the SDK, exactly as
  documented in the aqua-sdk README's "Execute a Swap through XYCSwap" example.
- **Token ordering** — Aqua's `XYCSwap` orders a pair by address
  (`token0 < token1`), so the compiler sorts `fromToken`/`toToken` and derives
  `zeroForOne` before encoding, rather than trusting client-supplied order.
- **viem for encoding** — all ABI encoding (`swap(...)`, `executeAtomic(...)`,
  Lido `submit(...)`) goes through `viem`'s `encodeAbiParameters` /
  `encodeFunctionData`, keeping the SDK responsible for Aqua protocol
  semantics and viem responsible for calldata bytes.

### `executeAtomic([aqua-swap, lido-submit])` batch logic

For every request, `compileAquaSwap()` first encodes the inner Aqua leg:

```
swap(app, strategy, zeroForOne, amountIn) -> Step 0: aqua-swap  (USDC -> ETH)
```

For the "Zap & Yield" flow (the only mode `/api/swap` currently serves), it
then encodes the Lido leg:

```
submit(referral) -> Step 1: lido-submit  (ETH -> stETH)
```

and packs both as `(target, value, callData)` entries into one SwapVM batch
call:

```solidity
executeAtomic([
  { target: aquaApp,     value: 0, callData: swap(...)   },  // Step 0
  { target: lidoStEth,   value: 0, callData: submit(...) }   // Step 1
])
```

`executeAtomic` runs the calls in order and reverts the **entire batch** if
either leg fails — this is what makes the swap and the stake atomic. The
route ([`app/api/swap/route.ts`](app/api/swap/route.ts)) returns this as a
single `{ to, data, value }` triple the wallet signs once; the wallet never
sees or signs "step 1" and "step 2" separately.
[`scripts/testSwapRoute.ts`](scripts/testSwapRoute.ts) asserts, byte-for-byte,
that the Aqua swap calldata and the Lido `submit` calldata are both embedded
verbatim inside the compiled `executeAtomic` payload.

### Gas savings analysis

The compiled batch carries a static gas budget of **420,000** units
(`DEFAULT_ZAP_GAS_LIMIT`), replaced with a live `eth_estimateGas` result
against `ETH_RPC_URL` whenever the RPC accepts it. The
[Transaction Terminal](components/TransactionTerminal.tsx) shows the delta
against the non-atomic alternative (separate `approve` + swap + stake
transactions) directly in its raw SwapVM trace:

| | Gas |
|---|---|
| Skipped ERC-20 `approve` transaction | 46,000 |
| Extra transaction intrinsic overhead (base cost of a 2nd tx) | 42,000 |
| **Total avoided** | **~88,000 gas** |
| Atomic batch cost | 420,000 |
| Equivalent non-atomic cost | ~508,000 |
| **Net reduction** | **~17%** |

That ~17% figure is what the running UI reports (`gas_saved` in the SwapVM
trace, [`components/TransactionTerminal.tsx`](components/TransactionTerminal.tsx)),
derived from the constants above rather than a live on-chain benchmark — the
periphery router isn't deployed yet, so this is a static estimate, not an
audited number. It scales further once real allowance/deposit gas costs (not
just the flat budgets used here) are measured against the fork.

## Architecture

```
┌───────────────────────┐   swipe right    ┌──────────────────────────────┐
│  Telegram Mini App     │ ────────────────▶│  Next.js  POST /api/swap      │
│  CardDeck / SwipeCard   │                  │  app/api/swap/route.ts        │
└───────────────────────┘                  └───────────────┬────────────────┘
                                                             │ parseSwapRequest
                                                             │ resolveSwapEnv
                                                             ▼
                                            ┌────────────────────────────────┐
                                            │ lib/aqua/compileSwap.ts          │
                                            │ compileAquaSwap()                │
                                            │  1. Aqua swap() calldata          │
                                            │  2. Lido submit() calldata        │
                                            │  3. executeAtomic([...])          │
                                            │  (offline, deterministic)         │
                                            └───────────────┬────────────────┘
                                    ┌─────────────────────┴─────────────────────┐
                                    ▼                                           ▼
                     ┌───────────────────────────┐               ┌───────────────────────────┐
                     │ 1inch Dev Portal            │               │ ETH_RPC_URL                 │
                     │ swap/v6.1/{chainId}/quote    │               │ eth_estimateGas              │
                     │ best-effort price quote      │               │ best-effort gas estimate     │
                     └───────────────────────────┘               └──────────────┬──────────────┘
                                                                                  ▼
                                                                   ┌───────────────────────────┐
                                                                   │ Hardhat Local Mainnet Fork  │
                                                                   │ chainId 31337                │
                                                                   │ scripts/setupFork.ts          │
                                                                   └───────────────────────────┘
```

The 1inch Dev Portal quote and the RPC gas estimate are both best-effort
enrichment — SwapVM calldata compiles offline and deterministically even if
both are unreachable; failures surface as `warnings` in the API response
instead of failing the request.

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env:
#   ETH_RPC_URL     — an archive-capable mainnet RPC (Alchemy/Infura/QuickNode)
#   ONEINCH_API_KEY — required by lib/aqua/compileSwap.ts (resolveSwapEnv);
#                     not currently listed in .env.example — add it manually,
#                     see docs/CHECKLIST.md

# 3. Start a local mainnet fork (separate terminal, keep it running)
npx hardhat node

# 4. Fund a test account with 5,000 USDC + 10 ETH from a whale on the fork
npx hardhat run scripts/setupFork.ts
# (equivalently: npm run fork:setup)

# 5. Start the app
npm run dev
```

Open `http://localhost:3000` in a browser for local dev, or point a Telegram
`@BotFather` Mini App WebApp URL at a deployed instance to test inside
Telegram.

Verify the compiler independently of the UI:

```bash
npm run test:swap            # direct, offline, deterministic
npm run test:swap -- --http  # also hits the live /api/swap (needs npm run dev)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling / motion | Tailwind CSS v4, Framer Motion |
| Telegram | `@twa-dev/sdk` |
| DeFi protocol | `@1inch/aqua-sdk` (Aqua SwapVM), viem (ABI encoding) |
| Local chain | Hardhat + `@nomicfoundation/hardhat-toolbox`, ethers (fork scripts) |
| Yield target | Lido Liquid Staking (`stETH`) |

## Security notes

- `/api/swap` never holds a private key or signs anything — it only compiles
  calldata; the connected wallet signs the final `executeAtomic` transaction.
- All request input is strictly validated (`parseSwapRequest`): addresses are
  checksummed via viem's `getAddress`, amounts must be positive base-10
  digits, native ETH is rejected as a source token, and identical
  `fromToken`/`toToken` is rejected — malformed input fails fast as HTTP 400
  rather than reaching the compiler.
- Missing server configuration (`ONEINCH_API_KEY`, `ETH_RPC_URL`) fails fast
  as HTTP 500 via `SwapConfigError` rather than compiling calldata against
  undefined addresses.
