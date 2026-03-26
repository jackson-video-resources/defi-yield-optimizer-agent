import { ethers } from "ethers";
import type { Chain } from "@lp-engine/shared";

const RPC: Record<Chain, string> = {
  arbitrum: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
  base: process.env.RPC_BASE || "https://mainnet.base.org",
  optimism: process.env.RPC_OPTIMISM || "https://mainnet.optimism.io",
};

const providers = new Map<Chain, ethers.JsonRpcProvider>();

export function getProvider(chain: Chain): ethers.JsonRpcProvider {
  if (!providers.has(chain)) {
    providers.set(chain, new ethers.JsonRpcProvider(RPC[chain]));
  }
  return providers.get(chain)!;
}

export function getSigner(chain: Chain, privateKey: string): ethers.Wallet {
  return new ethers.Wallet(privateKey, getProvider(chain));
}

export async function getGasPrice(chain: Chain): Promise<bigint> {
  const provider = getProvider(chain);
  const feeData = await provider.getFeeData();
  return feeData.gasPrice || BigInt("100000000"); // 0.1 gwei fallback
}
