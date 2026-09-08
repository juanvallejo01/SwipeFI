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

/**
 * Mainnet Lido Liquid Staking (stETH) contract. `submit(address referral)` is
 * payable: it takes the ETH sent with the call and mints the caller stETH 1:1.
 * This is Step 2 of the "Zap & Yield" flow — the ETH that Aqua produces in
 * Step 1 is deposited straight into Lido inside the same transaction.
 */
export const LIDO_STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";

/** All-zero address — the default Lido referral and native-token sentinel. */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Headline Lido staking APR surfaced to the UI; override with `LIDO_APY_ESTIMATE`. */
export const DEFAULT_LIDO_APY = "3.4%";

/** Gas budget for the atomic swap + Lido `submit` batch when no estimate is available. */
export const DEFAULT_ZAP_GAS_LIMIT = "420000";

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

/**
 * SwapVM batch entrypoint. `executeAtomic` runs an ordered list of sub-calls in
 * a single transaction and reverts the whole batch if any leg fails — this is
 * what makes "Zap & Yield" atomic: the Aqua swap and the Lido `submit` either
 * both land or neither does. Each `Call` mirrors the `(target, value, callData)`
 * shape used by common multicall routers.
 */
const SWAPVM_BATCH_ABI = [
  {
    type: "function",
    name: "executeAtomic",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
] as const;

/**
 * Lido stETH `submit(address _referral)` — payable. Deposits the ETH sent with
 * the call into Lido Liquid Staking and mints stETH to the caller.
 * @see https://docs.lido.fi/contracts/lido#submit
 */
const LIDO_STETH_ABI = [
  {
    type: "function",
    name: "submit",
    stateMutability: "payable",
    inputs: [{ name: "_referral", type: "address" }],
    outputs: [{ name: "sharesAmount", type: "uint256" }],
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
  /** Lido stETH contract the Zap & Yield flow stakes into. */
  lidoSteth: string;
  /** Referral address forwarded to Lido `submit` (defaults to the zero address). */
  lidoReferral: string;
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
    lidoSteth: normaliseAddressOr(env.LIDO_STETH_ADDRESS, LIDO_STETH_ADDRESS),
    lidoReferral: env.LIDO_REFERRAL_ADDRESS
      ? safeChecksum(env.LIDO_REFERRAL_ADDRESS, "LIDO_REFERRAL_ADDRESS")
      : getAddress(ZERO_ADDRESS),
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

/** Yield strategies the compiler can append to a swap. */
export type YieldStrategy = "lido-steth";

export interface CompileSwapOptions {
  /**
   * When set, the swap output is deposited into a yield protocol inside the same
   * transaction and `data` becomes an atomic SwapVM batch instead of a bare swap.
   * `"lido-steth"` → Aqua swap to ETH, then Lido `submit` → stETH.
   */
  yieldStrategy?: YieldStrategy;
}

/** One leg of an atomic SwapVM batch. */
export interface AtomicStep {
  index: number;
  kind: "aqua-swap" | "lido-submit";
  target: string;
  calldata: Hex;
}

/** Yield-leg metadata attached to a Zap & Yield compilation. */
export interface YieldMeta {
  strategy: YieldStrategy;
  /** Token the user ends up holding. */
  yieldToken: "stETH";
  targetProtocol: "Lido Staking";
  /** Lido stETH contract the batch stakes into. */
  lidoContract: string;
  /** Referral address passed to Lido `submit`. */
  referral: string;
  /** Encoded `submit(referral)` calldata (Step 2). */
  submitCalldata: Hex;
  /** Ordered legs packed into the atomic batch. */
  steps: AtomicStep[];
}

export interface CompiledSwap {
  /** SwapVM router contract to call. */
  to: string;
  /**
   * Compiled SwapVM execution calldata. A bare `swap(...)` call for a plain swap,
   * or an `executeAtomic([...])` batch (swap + Lido `submit`) for Zap & Yield.
   */
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
    /** The inner Aqua `swap(...)` calldata (Step 1), kept visible even when wrapped in a batch. */
    swapCalldata: Hex;
    /** Present only for a Zap & Yield compilation; `null` for a plain swap. */
    yield: YieldMeta | null;
    /** Maker-side liquidity provisioning tx built with the Aqua SDK, for reference. */
    aqua: { shipTo: string; shipCalldata: Hex };
  };
}

/**
 * Compiles the 1inch Aqua SwapVM execution calldata for `req`.
 * Deterministic and offline — no network access. Throws only on genuinely
 * un-encodable input (which `parseSwapRequest` should already have rejected).
 *
 * With `opts.yieldStrategy === "lido-steth"` it compiles the full "Zap & Yield"
 * flow instead of a bare swap:
 *   1. Swap input USDC → ETH through 1inch Aqua liquidity.
 *   2. Encode Lido `submit(referral)` to stake that ETH into Lido.
 *   3. Pack both legs into one `executeAtomic([...])` SwapVM batch so the whole
 *      operation lands (or reverts) in a single transaction.
 */
export function compileAquaSwap(
  req: SwapRequest,
  env: SwapEnv,
  opts: CompileSwapOptions = {},
): CompiledSwap {
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

  // Step 1 — taker-side Aqua swap calldata (USDC -> ETH via Aqua liquidity).
  const swapCalldata = encodeFunctionData({
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

  // Default (plain swap): the wallet signs the bare `swap(...)` call.
  let to = getAddress(env.swapRouter);
  let data: Hex = swapCalldata;
  let estimatedGas = DEFAULT_GAS_LIMIT;
  let yieldMeta: YieldMeta | null = null;

  if (opts.yieldStrategy === "lido-steth") {
    // Step 2 — encode Lido `submit(referral)` to stake the swapped-out ETH.
    const lidoContract = getAddress(env.lidoSteth);
    const referral = getAddress(env.lidoReferral);
    const submitCalldata = encodeFunctionData({
      abi: LIDO_STETH_ABI,
      functionName: "submit",
      args: [referral],
    });

    const steps: AtomicStep[] = [
      { index: 0, kind: "aqua-swap", target: getAddress(env.aquaApp), calldata: swapCalldata },
      { index: 1, kind: "lido-submit", target: lidoContract, calldata: submitCalldata },
    ];

    // Step 3 — pack both legs into one atomic SwapVM batch. The router forwards
    // the ETH produced by leg 0 into leg 0's Lido `submit`; `value` from the
    // user's wallet stays 0 because the source token is an ERC-20 (USDC).
    data = encodeFunctionData({
      abi: SWAPVM_BATCH_ABI,
      functionName: "executeAtomic",
      args: [steps.map((s) => ({ target: getAddress(s.target), value: BigInt(0), callData: s.calldata }))],
    });
    to = getAddress(env.swapRouter);
    estimatedGas = DEFAULT_ZAP_GAS_LIMIT;
    yieldMeta = {
      strategy: "lido-steth",
      yieldToken: "stETH",
      targetProtocol: "Lido Staking",
      lidoContract,
      referral,
      submitCalldata,
      steps,
    };
  }

  return {
    to,
    data,
    value: "0",
    estimatedGas,
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
      swapCalldata,
      yield: yieldMeta,
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
