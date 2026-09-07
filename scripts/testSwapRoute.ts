/**
 * SwipeFi — verification harness for the 1inch Aqua SwapVM compiler.
 *
 * Two modes:
 *   1. Direct (default): calls `parseSwapRequest` + `compileAquaSwap` in-process
 *      and asserts the SwapVM calldata compiles without throwing.
 *   2. HTTP (`--http`, or set SWAP_ROUTE_URL): POSTs a mock request to the running
 *      dev server at http://localhost:3000/api/swap and validates the response.
 *
 * Run:
 *   npm run test:swap            # direct, offline, deterministic
 *   npm run test:swap -- --http  # also hit the live route (needs `npm run dev`)
 */

import "dotenv/config";
import {
  compileAquaSwap,
  parseSwapRequest,
  resolveSwapEnv,
  SwapInputError,
  type SwapRequest,
} from "../lib/aqua/compileSwap";

// The compiler needs these two to be present; in direct mode their values are
// never dialled out to the network, so placeholders are fine for CI.
process.env.ONEINCH_API_KEY = process.env.ONEINCH_API_KEY || "test-key-direct-mode";
process.env.ETH_RPC_URL = process.env.ETH_RPC_URL || "http://127.0.0.1:8545";

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const WALLET = "0x28C6c06298d514Db089934071355E5743bf21d60";
const ROUTE_URL = process.env.SWAP_ROUTE_URL || "http://localhost:3000/api/swap";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const HEX = /^0x[0-9a-fA-F]+$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

function runDirectTests(): void {
  console.log("Direct compile tests");

  const env = resolveSwapEnv();
  const base: SwapRequest = {
    fromToken: USDC,
    toToken: WETH,
    amount: "5000000000", // 5,000 USDC
    walletAddress: WALLET,
  };

  check("compiles USDC -> WETH SwapVM calldata without throwing", () => {
    const out = compileAquaSwap(parseSwapRequest(base), env);
    assert(ADDRESS.test(out.to), `to is not an address: ${out.to}`);
    assert(HEX.test(out.data) && out.data.length > 10, `data is not calldata: ${out.data}`);
    assert(out.value === "0", `value should be "0", got ${out.value}`);
    assert(/^\d+$/.test(out.estimatedGas), `estimatedGas not numeric: ${out.estimatedGas}`);
    assert(BYTES32.test(out.meta.strategyHash), `strategyHash malformed: ${out.meta.strategyHash}`);
    assert(HEX.test(out.meta.strategy), `strategy bytes malformed`);
    assert(HEX.test(out.meta.aqua.shipCalldata), `ship calldata malformed`);
    assert(out.meta.zeroForOne === true, `USDC < WETH so zeroForOne should be true`);
  });

  check("routes a native-ETH target through WETH", () => {
    const out = compileAquaSwap(
      parseSwapRequest({ ...base, toToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" }),
      env,
    );
    assert(out.meta.wrapsNative === true, "wrapsNative should be true for native target");
    assert(HEX.test(out.data) && out.data.length > 10, "calldata missing for wrapped native swap");
  });

  check("rejects an invalid walletAddress (400-class)", () => {
    try {
      parseSwapRequest({ ...base, walletAddress: "0xnope" });
      throw new Error("expected SwapInputError");
    } catch (err) {
      assert(err instanceof SwapInputError, `wrong error type: ${err}`);
      assert(err.field === "walletAddress", `wrong field: ${err.field}`);
    }
  });

  check("rejects a zero amount (400-class)", () => {
    try {
      parseSwapRequest({ ...base, amount: "0" });
      throw new Error("expected SwapInputError");
    } catch (err) {
      assert(err instanceof SwapInputError, `wrong error type: ${err}`);
    }
  });

  check("rejects a non-integer amount (400-class)", () => {
    try {
      parseSwapRequest({ ...base, amount: "5.0" });
      throw new Error("expected SwapInputError");
    } catch (err) {
      assert(err instanceof SwapInputError, `wrong error type: ${err}`);
    }
  });

  check("rejects identical fromToken / toToken (400-class)", () => {
    try {
      parseSwapRequest({ ...base, toToken: USDC });
      throw new Error("expected SwapInputError");
    } catch (err) {
      assert(err instanceof SwapInputError, `wrong error type: ${err}`);
    }
  });

  check("rejects native ETH as the source token (400-class)", () => {
    try {
      parseSwapRequest({ ...base, fromToken: "0x0000000000000000000000000000000000000000" });
      throw new Error("expected SwapInputError");
    } catch (err) {
      assert(err instanceof SwapInputError, `wrong error type: ${err}`);
    }
  });
}

async function runHttpTests(): Promise<void> {
  console.log(`\nHTTP tests against ${ROUTE_URL}`);

  const post = (body: unknown) =>
    fetch(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    const res = await post({
      fromToken: USDC,
      toToken: WETH,
      amount: "5000000000",
      walletAddress: WALLET,
    });
    const json = (await res.json()) as Record<string, unknown>;

    check("POST valid payload -> 200 + success calldata", () => {
      assert(res.status === 200, `status ${res.status}: ${JSON.stringify(json)}`);
      assert(json.success === true, `success !== true: ${JSON.stringify(json)}`);
      assert(typeof json.data === "string" && HEX.test(json.data as string), "data missing/invalid");
      assert(ADDRESS.test(json.to as string), "to missing/invalid");
      assert(json.value === "0", "value should be 0");
    });

    const badRes = await post({ fromToken: "0xbad", toToken: WETH, amount: "1", walletAddress: WALLET });
    check("POST invalid address -> 400", () => {
      assert(badRes.status === 400, `expected 400, got ${badRes.status}`);
    });

    const badJson = await fetch(ROUTE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    check("POST malformed JSON -> 400", () => {
      assert(badJson.status === 400, `expected 400, got ${badJson.status}`);
    });
  } catch (err) {
    failed += 1;
    console.error(
      `  ✗ could not reach ${ROUTE_URL} — is \`npm run dev\` running?\n      ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function main(): Promise<void> {
  runDirectTests();

  if (process.argv.includes("--http") || process.env.SWAP_ROUTE_URL) {
    await runHttpTests();
  } else {
    console.log("\n(skipping HTTP tests — pass --http to run them against a live dev server)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
