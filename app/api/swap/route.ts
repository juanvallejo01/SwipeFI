/**
 * POST /api/swap — compile the atomic "Zap & Yield" SwapVM calldata.
 *
 * The route compiles a single transaction that:
 *   1. Swaps the input USDC to ETH through 1inch Aqua liquidity, then
 *   2. Deposits that ETH straight into Lido Liquid Staking (`submit`) for stETH,
 *   3. packed into one atomic SwapVM batch (`executeAtomic`).
 *
 * Body (JSON):
 *   { fromToken, toToken, amount, walletAddress }
 *     - fromToken     ERC-20 source address (e.g. USDC 0xA0b8...eB48)
 *     - toToken       swap target token (ERC-20, or 0xEeee.../0x0 for native ETH) —
 *                     the ETH leg that gets staked into Lido
 *     - amount        source amount in atomic units, as a decimal string
 *     - walletAddress the user's address (used as `from` for gas estimation)
 *
 * Success (200):
 *   { success: true, to, data, value, estimatedGas, meta, warnings }
 *     meta includes yield fields: expectedOut, yieldToken ("stETH"),
 *     targetProtocol ("Lido Staking"), estimatedApy.
 *
 * Errors:
 *   400 — malformed JSON or invalid field         { success: false, error, field? }
 *   500 — missing config or compilation failure   { success: false, error }
 */

import { NextResponse } from "next/server";
import {
  compileAquaSwap,
  DEFAULT_LIDO_APY,
  estimateGas,
  fetchOneInchQuote,
  parseSwapRequest,
  resolveSwapEnv,
  SwapConfigError,
  SwapInputError,
  type SwapRequest,
} from "@/lib/aqua/compileSwap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // 1. Parse the JSON body.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  // 2. Validate the payload.
  let swapRequest: SwapRequest;
  try {
    swapRequest = parseSwapRequest(rawBody);
  } catch (err) {
    if (err instanceof SwapInputError) {
      return NextResponse.json(
        { success: false, error: err.message, field: err.field ?? null },
        { status: 400 },
      );
    }
    throw err;
  }

  // 3. Load and validate server configuration.
  let env;
  try {
    env = resolveSwapEnv();
  } catch (err) {
    if (err instanceof SwapConfigError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: 500 },
      );
    }
    throw err;
  }

  // 4. Compile the atomic Zap & Yield calldata, then enrich it best-effort.
  try {
    const compiled = compileAquaSwap(swapRequest, env, { yieldStrategy: "lido-steth" });
    const warnings: string[] = [];
    const estimatedApy = process.env.LIDO_APY_ESTIMATE?.trim() || DEFAULT_LIDO_APY;

    const [gas, quoteResult] = await Promise.all([
      estimateGas(env, {
        from: swapRequest.walletAddress,
        to: compiled.to,
        data: compiled.data,
        value: compiled.value,
      }),
      fetchOneInchQuote(env, swapRequest),
    ]);

    if (gas.source === "fallback" && gas.error) {
      warnings.push(`gas estimate fell back to default (${gas.error})`);
    }
    if (!quoteResult.quote && quoteResult.error) {
      warnings.push(`1inch quote unavailable (${quoteResult.error})`);
    }

    return NextResponse.json(
      {
        success: true,
        to: compiled.to,
        data: compiled.data,
        value: compiled.value,
        estimatedGas: gas.estimatedGas,
        meta: {
          ...compiled.meta,
          gasSource: gas.source,
          expectedOut: quoteResult.quote?.dstAmount ?? null,
          yieldToken: compiled.meta.yield?.yieldToken ?? "stETH",
          targetProtocol: compiled.meta.yield?.targetProtocol ?? "Lido Staking",
          estimatedApy,
        },
        warnings,
      },
      { status: 200 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { success: false, error: `Failed to compile SwapVM calldata: ${message}` },
      { status: 500 },
    );
  }
}

/** Lightweight usage descriptor — handy for a quick `curl` sanity check. */
export function GET() {
  return NextResponse.json({
    name: "SwipeFi · Zap & Yield (1inch Aqua swap + Lido staking) compiler",
    method: "POST",
    flow: ["aqua-swap: USDC -> ETH", "lido-submit: ETH -> stETH", "executeAtomic: one transaction"],
    exampleBody: {
      fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      toToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      amount: "5000000000",
      walletAddress: "0x0000000000000000000000000000000000000000",
    },
  });
}
