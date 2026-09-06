import { ethers, network } from "hardhat";

/**
 * SwipeFi — local mainnet-fork bootstrap.
 *
 * Impersonates a known USDC whale, funds a local test account with ETH for gas,
 * and moves 5,000 USDC onto that account so the Zap & Yield flow
 * (USDC -> ETH -> stETH) can be exercised end-to-end against forked state.
 *
 * Run:  npx hardhat run scripts/setupFork.ts
 */

// --- Ethereum Mainnet contract addresses ---
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"; // Lido stETH

// Known USDC whale — Binance 14 hot wallet. Holds a large USDC + ETH balance
// on mainnet, so it survives most fork block heights.
const USDC_WHALE = "0x28C6c06298d514Db089934071355E5743bf21d60";

// Amounts to provision on the local test account.
const GAS_ETH = ethers.parseEther("10");
const USDC_AMOUNT_HUMAN = "5000";

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

async function main() {
  const forking = (network.config as { forking?: { url?: string } }).forking;
  if (!forking?.url) {
    throw new Error(
      "Mainnet fork is not configured. Set ETH_RPC_URL in .env (see .env.example)."
    );
  }

  const [testAccount] = await ethers.getSigners();

  console.log("SwipeFi fork setup");
  console.log("------------------");
  console.log(`Test account : ${testAccount.address}`);
  console.log(`USDC whale   : ${USDC_WHALE}`);
  console.log(`USDC         : ${USDC_ADDRESS}`);
  console.log(`Lido stETH   : ${STETH_ADDRESS}`);
  console.log("");

  // 1. Fund the test account with 10 ETH for gas.
  await network.provider.send("hardhat_setBalance", [
    testAccount.address,
    ethers.toBeHex(GAS_ETH),
  ]);

  // 2. Impersonate the whale and top up its ETH so it can pay for the transfer.
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [USDC_WHALE],
  });
  await network.provider.send("hardhat_setBalance", [
    USDC_WHALE,
    ethers.toBeHex(ethers.parseEther("100")),
  ]);
  const whale = await ethers.getSigner(USDC_WHALE);

  // 3. Transfer 5,000 USDC from the whale to the test account.
  const usdcAsWhale = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, whale);
  const decimals = Number(await usdcAsWhale.decimals());
  const usdcAmount = ethers.parseUnits(USDC_AMOUNT_HUMAN, decimals);

  const whaleBalance: bigint = await usdcAsWhale.balanceOf(USDC_WHALE);
  if (whaleBalance < usdcAmount) {
    throw new Error(
      `Whale holds only ${ethers.formatUnits(whaleBalance, decimals)} USDC at this fork block — ` +
        "pin a different blockNumber in hardhat.config.ts or choose another whale."
    );
  }

  const tx = await usdcAsWhale.transfer(testAccount.address, usdcAmount);
  await tx.wait();
  console.log(`Transferred ${USDC_AMOUNT_HUMAN} USDC  (tx ${tx.hash})`);

  // 4. Stop impersonating the whale.
  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [USDC_WHALE],
  });

  // 5. Read back and log the test account balances to confirm funding.
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, ethers.provider);
  const usdcBalance: bigint = await usdc.balanceOf(testAccount.address);
  const ethBalance: bigint = await ethers.provider.getBalance(testAccount.address);

  console.log("");
  console.log("Test account balances");
  console.log("---------------------");
  console.log(`ETH  : ${ethers.formatEther(ethBalance)}`);
  console.log(`USDC : ${ethers.formatUnits(usdcBalance, decimals)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
