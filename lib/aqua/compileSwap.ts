/**
 * SwipeFi — 1inch Aqua SwapVM calldata compiler.
 *
 * Pure, framework-free helpers shared by the `/api/swap` route handler and the
 * `scripts/testSwapRoute.ts` verification script. Nothing here touches Next.js so
 * it can be unit-tested or driven from a plain Node process.
 *
 * The compiler encodes the execution calldata for a single swap routed through
 * 1inch Aqua liquidity (the reference XYCSwap constant-product app). It uses the
 * official `@1inch/aqua-sdk` for the Aqua protocol contract address book and the
 * strategy-hash primitive, and `viem` for ABI encoding.
 */

import {
  AquaProtocolContract,
  AQUA_CONTRACT_ADDRESSES,
  Address,
  HexString,
  NetworkEnum,
} from "@1inch/aqua-sdk";
import { encodeAbiParameters, encodeFunctionData, getAddress, type Hex } from "viem";

/** Aqua is compiled against Ethereum mainnet state (matches the Day 3 fork). */
export const CHAIN_ID: number = NetworkEnum.ETHEREUM; // 1

/** Canonical mainnet token addresses for the Zap & Yield flow. */
export const MAINNET_USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const MAINNET_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

/** Sentinels the 1inch APIs use for "native ETH". Routed through WETH inside Aqua. */
const NATIVE_TOKEN_ALIASES = new Set<string>([
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "0x0000000000000000000000000000000000000000",
]);

/** Gas budget returned when an on-chain estimate is unavailable. */
export const DEFAULT_GAS_LIMIT = "260000";

/** Strategy schema for the reference XYCSwap Aqua app (see 1inch/aqua XYCSwap.sol). */
const STRATEGY_COMPONENTS = [
  { name: "maker", type: "address" },
  { name: "token0", type: "address" },
  { name: "token1", type: "address" },
  { name: "feeBps", type: "uint256" },
  { name: "salt", type: "bytes32" },
] as const;

/**
 * Periphery router entrypoint that drives one Aqua SwapVM execution.
 * Mirrors the `swap(app, strategy, zeroForOne, amountIn)` helper documented in
 * the aqua-sdk README ("Execute a Swap through XYCSwap").
 */
const SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "nonpayable",
    inputs: [
      { name: "app", type: "address" },
      {
        name: "strategy",
        type: "tuple",
        components: [
          { name: "maker", type: "address" },
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "feeBps", type: "uint256" },
          { name: "salt", type: "bytes32" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

// --- Errors ----------------------------------------------------------------

/** Bad client input — surfaced as HTTP 400. */
export class SwapInputError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = "SwapInputError";
    this.field = field;
  }
}

/** Bad / missing server configuration — surfaced as HTTP 500. */
export class SwapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwapConfigError";
  }
}

// --- Environment ---------------------------------------------------------------

export interface SwapEnv {
  oneInchApiKey: string;
  ethRpcUrl: string;
  aquaContract: string;
  swapRouter: string;
  aquaApp: string;
  /** LP address whose shipped strategy is being traded against, if known. */
  maker: string | null;
  strategySalt: Hex;
}

/**
 * Reads and validates the server configuration from `process.env`.
 * `ONEINCH_API_KEY` and `ETH_RPC_URL` are mandatory; everything else falls back
 * to the canonical Aqua protocol contract address so the compiler stays usable
 * before the periphery router / app are deployed to the fork.
 */
export function resolveSwapEnv(env: NodeJS.ProcessEnv = process.env): SwapEnv {
  const oneInchApiKey = env.ONEINCH_API_KEY?.trim();
  const ethRpcUrl = env.ETH_RPC_URL?.trim();

  const missing: string[] = [];
  if (!oneInchApiKey) missing.push("ONEINCH_API_KEY");
  if (!ethRpcUrl) missing.push("ETH_RPC_URL");
  if (missing.length > 0) {
    throw new SwapConfigError(
      `Missing required environment variable(s): ${missing.join(", ")}`,
    );
  }

  const aquaContract = normaliseAddressOr(
    env.AQUA_CONTRACT_ADDRESS,
    AQUA_CONTRACT_ADDRESSES[NetworkEnum.ETHEREUM].toString(),
  );

  return {
    oneInchApiKey: oneInchApiKey as string,
    ethRpcUrl: ethRpcUrl as string,
    aquaContract,
    swapRouter: normaliseAddressOr(env.SWAPVM_ROUTER_ADDRESS, aquaContract),
    aquaApp: normaliseAddressOr(env.AQUA_APP_ADDRESS, aquaContract),
    maker: env.AQUA_MAKER_ADDRESS ? safeChecksum(env.AQUA_MAKER_ADDRESS, "AQUA_MAKER_ADDRESS") : null,
    strategySalt: normaliseSalt(env.AQUA_STRATEGY_SALT),
  };
}

function normaliseAddressOr(value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  return raw ? safeChecksum(raw, "environment address") : getAddress(fallback);
}

function safeChecksum(raw: string, label: string): string {
  try {
    return getAddress(raw);
  } catch {
    throw new SwapConfigError(`Invalid ${label} in configuration: ${raw}`);
  }
}

function normaliseSalt(value: string | undefined): Hex {
  const raw = value?.trim();
  if (!raw) return `0x${"00".repeat(31)}01`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new SwapConfigError(
      "AQUA_STRATEGY_SALT must be a 32-byte 0x-prefixed hex string",
    );
  }
  return raw.toLowerCase() as Hex;
}

// --- Request parsing ---------------------------------------------------------

export interface SwapRequest {
  fromToken: string;
  toToken: string;
  /** Atomic units of `fromToken`, base-10 digits only (e.g. "5000000000"). */
  amount: string;
  walletAddress: string;
}

/**
 * Strictly validates an untrusted JSON payload into a `SwapRequest`.
 * Throws `SwapInputError` (→ HTTP 400) on any malformed field.
 */
export function parseSwapRequest(raw: unknown): SwapRequest {
  if (typeof raw !== "object" || raw === null) {
    throw new SwapInputError("Request body must be a JSON object");
  }
  const body = raw as Record<string, unknown>;

  const fromToken = requireAddress(body.fromToken, "fromToken");
  const toToken = requireAddress(body.toToken, "toToken");
  const walletAddress = requireAddress(body.walletAddress, "walletAddress");

  if (typeof body.amount !== "string" || !/^\d+$/.test(body.amount)) {
    throw new SwapInputError(
      "amount must be a string of atomic units (base-10 digits only)",
      "amount",
    );
  }
  if (BigInt(body.amount) <= BigInt(0)) {
    throw new SwapInputError("amount must be greater than zero", "amount");
  }

  if (NATIVE_TOKEN_ALIASES.has(fromToken.toLowerCase())) {
    throw new SwapInputError(
      "Native ETH is not supported as the source token; supply an ERC-20 such as USDC",
      "fromToken",
    );
  }
  if (fromToken.toLowerCase() === toToken.toLowerCase()) {
    throw new SwapInputError("fromToken and toToken must differ", "toToken");
  }

  return { fromToken, toToken, amount: body.amount, walletAddress };
}

function requireAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new SwapInputError(`${field} is required`, field);
  }
  try {
    return getAddress(value);
  } catch {
    throw new SwapInputError(`${field} is not a valid EVM address`, field);
  }
}

// --- Compilation -----------------------------------------------------------

export interface CompiledSwap {
  /** SwapVM router contract to call. */
  to: string;
  /** Compiled SwapVM execution calldata. */
  data: Hex;
  /** Wei to send with the call (always "0" — source token is an ERC-20). */
  value: string;
  /** Static gas budget; the route replaces this with an on-chain estimate when possible. */
  estimatedGas: string;
  meta: {
    chainId: number;
    aquaContract: string;
    aquaApp: string;
    strategy: Hex;
    strategyHash: Hex;
    zeroForOne: boolean;
    poolToken0: string;
    poolToken1: string;
    /** True when the requested `toToken` was native ETH and got routed via WETH. */
    wrapsNative: boolean;
    maker: string;
    /** Maker-side liquidity provisioning tx built with the Aqua SDK, for reference. */
    aqua: { shipTo: string; shipCalldata: Hex };
  };
}

/**
 * Compiles the 1inch Aqua SwapVM execution calldata for `req`.
 * Deterministic and offline — no network access. Throws only on genuinely
 * un-encodable input (which `parseSwapRequest` should already have rejected).
 */
export function compileAquaSwap(req: SwapRequest, env: SwapEnv): CompiledSwap {
  const wrapsNative = NATIVE_TOKEN_ALIASES.has(req.toToken.toLowerCase());
  const targetToken = wrapsNative ? getAddress(MAINNET_WETH) : req.toToken;
  const maker = getAddress(env.maker ?? env.aquaApp);

  // XYCSwap orders the pair by address: token0 is the numerically-smaller one.
  const fromIsToken0 = BigInt(req.fromToken) < BigInt(targetToken);
  const token0 = getAddress(fromIsToken0 ? req.fromToken : targetToken);
  const token1 = getAddress(fromIsToken0 ? targetToken : req.fromToken);
  const zeroForOne = fromIsToken0;

  const strategyTuple = {
    maker,
    token0,
    token1,
    feeBps: BigInt(0),
    salt: env.strategySalt,
  } as const;

  const strategy = encodeAbiParameters(
    [{ name: "strategy", type: "tuple", components: STRATEGY_COMPONENTS }],
    [strategyTuple],
  );

  const strategyHash = AquaProtocolContract.calculateStrategyHash(
    new HexString(strategy),
  ).toString();

  // Taker-side execution calldata: this is what the user's wallet signs.
  const data = encodeFunctionData({
    abi: SWAP_ROUTER_ABI,
    functionName: "swap",
    args: [getAddress(env.aquaApp), strategyTuple, zeroForOne, BigInt(req.amount)],
  });

  // Maker-side provisioning tx, built through the Aqua SDK — handy for the demo
  // and to prove the SDK wiring end-to-end.
  const aqua = new AquaProtocolContract(new Address(env.aquaContract));
  const shipTx = aqua.ship({
    app: new Address(env.aquaApp),
    strategy: new HexString(strategy),
    amountsAndTokens: [
      { token: new Address(req.fromToken), amount: BigInt(req.amount) },
    ],
  });

  return {
    to: getAddress(env.swapRouter),
    data,
    value: "0",
    estimatedGas: DEFAULT_GAS_LIMIT,
    meta: {
      chainId: CHAIN_ID,
      aquaContract: getAddress(env.aquaContract),
      aquaApp: getAddress(env.aquaApp),
      strategy,
      strategyHash: strategyHash as Hex,
      zeroForOne,
      poolToken0: token0,
      poolToken1: token1,
      wrapsNative,
      maker,
      aqua: { shipTo: getAddress(shipTx.to), shipCalldata: shipTx.data as Hex },
    },
  };
}

// --- Best-effort enrichment ----------------------------------------------------

function toHexQuantity(decimal: string): Hex {
  return `0x${BigInt(decimal).toString(16)}` as Hex;
}

export interface GasEstimate {
  estimatedGas: string;
  source: "rpc" | "fallback";
  error?: string;
}

/**
 * Best-effort `eth_estimateGas` against `ETH_RPC_URL`. Never throws — on any
 * failure it returns the static fallback with an `error` describing why. A
 * revert here is expected until the periphery router is actually deployed.
 */
export async function estimateGas(
  env: SwapEnv,
  tx: { from: string; to: string; data: Hex; value?: string },
): Promise<GasEstimate> {
  try {
    const res = await fetch(env.ethRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_estimateGas",
        params: [
          {
            from: tx.from,
            to: tx.to,
            data: tx.data,
            value: tx.value && tx.value !== "0" ? toHexQuantity(tx.value) : "0x0",
          },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
    const json = (await res.json()) as {
      result?: string;
      error?: { message?: string };
    };
    if (typeof json.result === "string") {
      return { estimatedGas: BigInt(json.result).toString(), source: "rpc" };
    }
    return {
      estimatedGas: DEFAULT_GAS_LIMIT,
      source: "fallback",
      error: json.error?.message ?? "RPC returned no result",
    };
  } catch (err) {
    return {
      estimatedGas: DEFAULT_GAS_LIMIT,
      source: "fallback",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface OneInchQuoteResult {
  quote: { dstAmount?: string; gas?: number } | null;
  error?: string;
}

/**
 * Best-effort price quote from the 1inch Dev Portal, used only to enrich the
 * response with an expected output amount. Never throws.
 */
export async function fetchOneInchQuote(
  env: SwapEnv,
  req: SwapRequest,
): Promise<OneInchQuoteResult> {
  try {
    const url = new URL(`https://api.1inch.dev/swap/v6.1/${CHAIN_ID}/quote`);
    url.searchParams.set("src", req.fromToken);
    url.searchParams.set("dst", req.toToken);
    url.searchParams.set("amount", req.amount);
    url.searchParams.set("includeGas", "true");

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.oneInchApiKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return { quote: null, error: `1inch quote HTTP ${res.status}` };
    }
    return { quote: (await res.json()) as OneInchQuoteResult["quote"] };
  } catch (err) {
    return { quote: null, error: err instanceof Error ? err.message : String(err) };
  }
}
