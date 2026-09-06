import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const ETH_RPC_URL = process.env.ETH_RPC_URL ?? "";

if (!ETH_RPC_URL) {
  console.warn(
    "[hardhat] ETH_RPC_URL is not set — the mainnet fork is disabled. " +
      "Copy .env.example to .env and add an archive RPC endpoint."
  );
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // In-process network used by `npx hardhat run` / `npx hardhat test`.
    hardhat: {
      chainId: 31337,
      forking: ETH_RPC_URL
        ? {
            url: ETH_RPC_URL,
            // Pin a block for deterministic runs / faster cache hits.
            // blockNumber: 20_900_000,
          }
        : undefined,
    },
    // Standalone node started with `npx hardhat node`.
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
};

export default config;
