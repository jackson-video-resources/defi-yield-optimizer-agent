import type { Chain, Pool } from "./types.js";

// Uniswap V3 NonfungiblePositionManager — same address on all chains
export const NPM_ADDRESS = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

// Uniswap V3 Factory — same on Arbitrum, Optimism; different on Base
export const FACTORY_ADDRESSES: Record<Chain, string> = {
  arbitrum: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
  base: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
  optimism: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
};

// Uniswap V3 SwapRouter02
export const SWAP_ROUTER_ADDRESSES: Record<Chain, string> = {
  arbitrum: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
  base: "0x2626664c2603336E57B271c5C0b26F421741e481",
  optimism: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
};

// Stablecoin addresses per chain
export const TOKEN_ADDRESSES: Record<Chain, Record<string, string>> = {
  arbitrum: {
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    USDe: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  },
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    USDe: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  },
  optimism: {
    USDC: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    USDT: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    DAI: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  },
};

// Ethereum mainnet USDC/USDT 0.01% — used for ML training data (rich volume history)
// L2 USDC/USDT pools have near-zero on-chain volume; mainnet has $100K-2M/hr volume
// On-chain execution addresses:
//   Arbitrum USDC/USDT 0.01%: 0xbE3aD6a5669dc0B8B12FeBC03608860c31E2eEF6
//   Base USDC/USDbC 0.01%:    0x06959273e9a65433de71f5a452d529544e07ddd0
//   Optimism USDC/USDT 0.01%: 0xa73c628eaf6e283e26a7b1f8001cf186aa4c0e8e
export const EXECUTION_POOL_ADDRESSES: Record<Chain, string> = {
  arbitrum: "0xbE3aD6a5669dc0B8B12FeBC03608860c31E2eEF6",
  base: "0x06959273e9a65433de71f5a452d529544e07ddd0",
  optimism: "0xa73c628eaf6e283e26a7b1f8001cf186aa4c0e8e",
};

// Target pools for data ingestion — all use the Ethereum mainnet USDC/USDT pool
// which has the richest volume history ($39M TVL, $400K-2M/hr volume).
// L2 stablecoin pools are illiquid for subgraph data (volume≈0) but execute fine on-chain.
export const TARGET_POOLS: Pool[] = [
  // Arbitrum training data — mainnet USDC/USDT 0.01% proxy
  {
    address: "0x3416cf6c708da44db2624d63ea0aaef7113527c6",
    chain: "arbitrum",
    token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // mainnet USDC
    token1: "0xdac17f958d2ee523a2206206994597c13d831ec7", // mainnet USDT
    token0Symbol: "USDC",
    token1Symbol: "USDT",
    feeTier: 100,
    tickSpacing: 1,
  },
  // Base training data — same mainnet pool (all patterns are chain-agnostic)
  {
    address: "0x3416cf6c708da44db2624d63ea0aaef7113527c6",
    chain: "base",
    token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    token1: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    token0Symbol: "USDC",
    token1Symbol: "USDT",
    feeTier: 100,
    tickSpacing: 1,
  },
  // Optimism training data — same mainnet pool
  {
    address: "0x3416cf6c708da44db2624d63ea0aaef7113527c6",
    chain: "optimism",
    token0: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    token1: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    token0Symbol: "USDC",
    token1Symbol: "USDT",
    feeTier: 100,
    tickSpacing: 1,
  },
];

// The Graph decentralized network — requires GRAPH_API_KEY env var
// All chains use the Ethereum mainnet Uniswap V3 subgraph for training data quality.
// (Subgraph ID: 5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV — $39M TVL, rich hourly data)
const GRAPH_KEY = process.env.GRAPH_API_KEY || "GRAPH_API_KEY_REQUIRED";
const MAINNET_SUBGRAPH = `https://gateway.thegraph.com/api/${GRAPH_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`;
export const SUBGRAPH_URLS: Record<Chain, string> = {
  arbitrum: MAINNET_SUBGRAPH,
  base: MAINNET_SUBGRAPH,
  optimism: MAINNET_SUBGRAPH,
};

// Fee tiers
export const FEE_TIER_TO_TICK_SPACING: Record<number, number> = {
  100: 1, // 0.01%
  500: 10, // 0.05%
  3000: 60, // 0.30%
  10000: 200, // 1.00%
};

// Stablecoins we monitor for depeg
export const MONITORED_STABLECOINS = ["USDC", "USDT", "DAI", "USDe", "USDbC"];

// Risk thresholds
export const RISK = {
  DEPEG_WARNING_PCT: 0.3, // Widen ranges
  DEPEG_EXIT_PCT: 0.5, // Exit positions
  MAX_RANGE_TICKS: 50,
  MIN_RANGE_TICKS: 1,
  BASE_RANGE_TICKS: 10,
  MAX_REBALANCES_PER_DAY: 8,
  DAILY_GAS_BUDGET_USD: 5,
};
