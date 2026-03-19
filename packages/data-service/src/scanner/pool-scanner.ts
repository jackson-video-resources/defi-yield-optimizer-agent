/**
 * Pool scanner — discovers and ranks stablecoin pools across chains.
 * Runs hourly to identify the highest fee-generating opportunities.
 */

import { fetchPoolState, type PoolStateData } from "./subgraph-client.js";
import { fetchStablecoinYields, type YieldPool } from "./defillama-client.js";
import { TARGET_POOLS } from "@lp-engine/shared";
import type { Chain } from "@lp-engine/shared";

export interface ScoredPool {
  chain: Chain;
  poolAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number;
  tvlUsd: number;
  volume24hUsd: number;
  fee24hUsd: number;
  feeAPY: number; // annualized fee APY based on last 24h
  score: number; // composite score for capital allocation
  state: PoolStateData | null;
}

/**
 * Score a pool based on fee yield and risk factors.
 * Higher score = more attractive for capital deployment.
 *
 * Score = fee_apy * capital_efficiency_factor / risk_factor
 * Where:
 *   capital_efficiency_factor = TVL / (TVL + 1M) — pools with more TVL are harder to compete in
 *   risk_factor = 1 + (1 / pool_age_days) — newer pools are riskier
 */
function scorePool(pool: ScoredPool): number {
  if (pool.tvlUsd === 0) return 0;

  // Fee APY: annualize last 24h fees
  const dailyFeeRate = pool.fee24hUsd / pool.tvlUsd;
  const feeAPY = dailyFeeRate * 365 * 100; // as percentage

  // Penalize very small pools (hard to enter/exit without moving price)
  const tvlFactor = pool.tvlUsd > 500_000 ? 1.0 : pool.tvlUsd / 500_000;

  // Penalize pools with very low volume (our share of fees would be tiny)
  const volumeFactor =
    pool.volume24hUsd > 100_000 ? 1.0 : pool.volume24hUsd / 100_000;

  return feeAPY * tvlFactor * volumeFactor;
}

/**
 * Scan all target pools and return scored results.
 */
export async function scanTargetPools(): Promise<ScoredPool[]> {
  const results: ScoredPool[] = [];

  for (const pool of TARGET_POOLS) {
    try {
      const state = await fetchPoolState(pool.chain, pool.address);

      const scored: ScoredPool = {
        chain: pool.chain,
        poolAddress: pool.address,
        token0Symbol: pool.token0Symbol,
        token1Symbol: pool.token1Symbol,
        feeTier: pool.feeTier,
        tvlUsd: state?.tvlUsd || 0,
        volume24hUsd: state?.volume24hUsd || 0,
        fee24hUsd: state?.fee24hUsd || 0,
        feeAPY: state ? (state.fee24hUsd / state.tvlUsd) * 365 * 100 : 0,
        score: 0,
        state,
      };

      scored.score = scorePool(scored);
      results.push(scored);
    } catch (err) {
      console.error(
        `[pool-scanner] Error scanning ${pool.chain}:${pool.address}: ${err}`,
      );
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Get the top N pools for capital deployment.
 */
export async function getTopPools(n: number = 3): Promise<ScoredPool[]> {
  const all = await scanTargetPools();
  return all.slice(0, n);
}

/**
 * Log a pool scan summary to console.
 */
export function logPoolScan(pools: ScoredPool[]): void {
  console.log(
    "\n[pool-scanner] ── Pool Scan Results ─────────────────────────────────",
  );
  for (const p of pools) {
    console.log(
      `  ${p.chain.padEnd(10)} ${(p.token0Symbol + "/" + p.token1Symbol).padEnd(12)} ` +
        `TVL: $${(p.tvlUsd / 1e6).toFixed(1)}M  ` +
        `Vol: $${(p.volume24hUsd / 1e6).toFixed(1)}M/24h  ` +
        `APY: ${p.feeAPY.toFixed(2)}%  ` +
        `Score: ${p.score.toFixed(1)}`,
    );
  }
  console.log(
    "[pool-scanner] ──────────────────────────────────────────────────────\n",
  );
}
