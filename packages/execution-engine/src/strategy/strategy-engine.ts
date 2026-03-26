import "dotenv/config";
import fetch from "node-fetch";
import { db } from "../db/index.js";
import {
  poolHourData,
  rebalanceEvents,
  portfolioSnapshots,
  aiDecisions,
  stablecoinPegSnapshots,
} from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import {
  TARGET_POOLS,
  EXECUTION_POOL_ADDRESSES,
  RISK,
} from "@lp-engine/shared";
import type { Chain } from "@lp-engine/shared";
import {
  openPaperPosition,
  closePaperPosition,
  updatePaperFees,
  getAllPositions,
  isInRange,
  type PaperPosition,
} from "../position/paper-position.js";

const ML_URL = process.env.ML_URL || "http://localhost:4002";
const PAPER_TRADING = process.env.PAPER_TRADING !== "false";
const GAS_COST_USD = 2.0; // L2 gas estimate per rebalance
const CAPITAL_PER_CHAIN = parseFloat(process.env.CAPITAL_PER_CHAIN || "1000");

interface PoolState {
  chain: Chain;
  poolAddress: string;
  currentTick: number;
  tvlUsd: number;
  volume24hUsd: number;
  fee24hUsd: number;
}

async function fetchCurrentPoolState(chain: Chain): Promise<PoolState | null> {
  // Get latest pool_hour_data from DB
  const rows = await db
    .select()
    .from(poolHourData)
    .where(eq(poolHourData.chain, chain))
    .orderBy(desc(poolHourData.hourTimestamp))
    .limit(1);

  if (!rows.length) return null;
  const row = rows[0];

  return {
    chain,
    poolAddress: EXECUTION_POOL_ADDRESSES[chain],
    currentTick: row.tick,
    tvlUsd: row.tvlUsd,
    volume24hUsd: row.volumeUsd * 24, // extrapolate from hourly
    fee24hUsd: row.feeUsd * 24,
  };
}

async function fetchVolPrediction(
  chain: Chain,
  currentTick: number,
  prevTick: number,
  depegProb: number,
): Promise<{ volBps: number; rangeTicks: number }> {
  try {
    const res = await fetch(`${ML_URL}/predict/volatility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        poolKey: `${chain}-usdc-usdt`,
        currentTick,
        prevTick,
        depegProb,
      }),
    });
    return (await res.json()) as { volBps: number; rangeTicks: number };
  } catch {
    return { volBps: 1.0, rangeTicks: RISK.BASE_RANGE_TICKS };
  }
}

async function fetchDepegCheck(
  pegDeviations: Record<string, number>,
  poolKey: string,
): Promise<{ probability: number; action: string }> {
  try {
    const res = await fetch(`${ML_URL}/predict/depeg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviations: pegDeviations, poolKey }),
    });
    return (await res.json()) as { probability: number; action: string };
  } catch {
    return { probability: 0, action: "none" };
  }
}

async function getCurrentPegDeviations(): Promise<Record<string, number>> {
  try {
    const rows = await db
      .select()
      .from(stablecoinPegSnapshots)
      .orderBy(desc(stablecoinPegSnapshots.timestamp))
      .limit(10);

    const deviations: Record<string, number> = {};
    for (const row of rows) {
      if (!deviations[row.symbol]) {
        deviations[row.symbol] = row.deviationPct;
      }
    }
    return deviations;
  } catch {
    return {};
  }
}

function shouldRebalance(
  pos: PaperPosition,
  currentTick: number,
  volBps: number,
  expectedHourlyFees: number,
): { rebalance: boolean; reason: string } {
  const inRange = isInRange(pos, currentTick);

  if (!inRange) {
    // Check gas payback: rebalance if gas cost < 2h of fees
    if (expectedHourlyFees > 0 && GAS_COST_USD / expectedHourlyFees <= 2) {
      return { rebalance: true, reason: "out_of_range_gas_justified" };
    }
    // High vol → price may return to range, wait
    if (volBps > RISK.DEPEG_WARNING_PCT * 10) {
      return { rebalance: false, reason: "out_of_range_high_vol_wait" };
    }
    return { rebalance: false, reason: "out_of_range_gas_too_expensive" };
  }

  // Preemptive: price at >80% toward either edge of range
  const rangeWidth = pos.tickUpper - pos.tickLower;
  if (rangeWidth > 0) {
    const distToEdge = Math.min(
      currentTick - pos.tickLower,
      pos.tickUpper - currentTick,
    );
    const pctToEdge = 1 - distToEdge / (rangeWidth / 2);
    if (
      pctToEdge > 0.8 &&
      expectedHourlyFees > 0 &&
      GAS_COST_USD / expectedHourlyFees <= 2
    ) {
      return { rebalance: true, reason: "preemptive_80pct_edge" };
    }
  }

  return { rebalance: false, reason: "in_range_collecting_fees" };
}

async function executeRebalance(
  pos: PaperPosition,
  newTickLower: number,
  newTickUpper: number,
  reason: string,
  predictions: Record<string, unknown>,
): Promise<void> {
  console.log(
    `[strategy] Rebalancing ${pos.chain}: [${pos.tickLower}, ${pos.tickUpper}] → [${newTickLower}, ${newTickUpper}] (${reason})`,
  );

  if (!PAPER_TRADING) {
    // TODO Phase 5: actual on-chain execution via NPM
    throw new Error("Live trading not yet implemented");
  }

  const oldLower = pos.tickLower;
  const oldUpper = pos.tickUpper;
  pos.tickLower = newTickLower;
  pos.tickUpper = newTickUpper;
  pos.gasSpent += GAS_COST_USD;
  pos.capitalUsd -= GAS_COST_USD;

  // Persist rebalance event to DB
  try {
    await db.insert(rebalanceEvents).values({
      positionId: pos.id,
      chain: pos.chain,
      poolAddress: pos.poolAddress,
      oldTickLower: oldLower,
      oldTickUpper: oldUpper,
      newTickLower,
      newTickUpper,
      gasCostUsd: GAS_COST_USD,
      feesCollectedUsd: 0,
      reason,
      modelPrediction: predictions,
      timestamp: new Date(),
    });
  } catch (e) {
    console.error("[strategy] Failed to log rebalance event:", e);
  }
}

// Per-chain tick tracking across loop iterations
const tickState = new Map<Chain, number>();

export async function runStrategyTick(): Promise<void> {
  const pegDeviations = await getCurrentPegDeviations();

  for (const pool of TARGET_POOLS) {
    const chain = pool.chain;

    try {
      const state = await fetchCurrentPoolState(chain);
      if (!state) {
        console.log(`[strategy] No pool data yet for ${chain}, skipping`);
        continue;
      }

      const prevTick = tickState.get(chain) ?? state.currentTick;
      tickState.set(chain, state.currentTick);

      const poolKey = `${chain}-${pool.token0Symbol}-${pool.token1Symbol}`;

      // 1. Depeg check — highest priority
      const { probability: depegProb, action: depegAction } =
        await fetchDepegCheck(pegDeviations, poolKey);

      if (depegAction === "exit") {
        console.log(
          `[strategy] DEPEG EXIT signal for ${chain} — closing all positions`,
        );
        for (const pos of getAllPositions().filter((p) => p.chain === chain)) {
          closePaperPosition(pos.id);
        }
        continue;
      }

      // 2. Volatility forecast + range sizing
      const { volBps, rangeTicks } = await fetchVolPrediction(
        chain,
        state.currentTick,
        prevTick,
        depegProb,
      );

      // Widen range 3x on elevated depeg risk
      const effectiveRangeTicks =
        depegAction === "widen"
          ? Math.min(rangeTicks * 3, RISK.MAX_RANGE_TICKS)
          : Math.max(rangeTicks, RISK.MIN_RANGE_TICKS);

      const newTickLower = state.currentTick - effectiveRangeTicks;
      const newTickUpper = state.currentTick + effectiveRangeTicks;

      // 3. Open initial position if none exist for this chain
      let chainPositions = getAllPositions().filter((p) => p.chain === chain);

      if (chainPositions.length === 0) {
        const pos = openPaperPosition(
          chain,
          newTickLower,
          newTickUpper,
          CAPITAL_PER_CHAIN,
        );
        console.log(
          `[strategy] Opened paper position ${pos.id} on ${chain}: ticks [${newTickLower}, ${newTickUpper}]`,
        );
        chainPositions = [pos];
      }

      // 4. Expected hourly fees (our proportional share of pool fees)
      const expectedHourlyFees =
        state.tvlUsd > 0
          ? (state.volume24hUsd / 24) *
            (pool.feeTier / 1_000_000) *
            (CAPITAL_PER_CHAIN / state.tvlUsd)
          : 0;

      // 5. Accrue paper fees for in-range positions
      for (const pos of chainPositions) {
        if (isInRange(pos, state.currentTick)) {
          updatePaperFees(pos.id, expectedHourlyFees);
        }
      }

      // 6. Rebalance check for each position
      for (const pos of chainPositions) {
        const { rebalance, reason } = shouldRebalance(
          pos,
          state.currentTick,
          volBps,
          expectedHourlyFees,
        );

        if (rebalance) {
          await executeRebalance(pos, newTickLower, newTickUpper, reason, {
            volBps,
            rangeTicks: effectiveRangeTicks,
            depegProb,
            expectedHourlyFees,
          });
        }
      }

      // 7. Log AI decision record
      try {
        const rebalanceNeeded = chainPositions.some(
          (p) =>
            shouldRebalance(p, state.currentTick, volBps, expectedHourlyFees)
              .rebalance,
        );
        await db.insert(aiDecisions).values({
          timestamp: new Date(),
          decisionType: "rebalance_check",
          chain,
          poolAddress: state.poolAddress,
          reasoning: JSON.stringify({
            depegAction,
            volBps,
            rangeTicks: effectiveRangeTicks,
          }),
          modelInputs: {
            currentTick: state.currentTick,
            prevTick,
            depegProb,
            volBps,
            tvlUsd: state.tvlUsd,
          },
          modelOutputs: {
            rangeTicks: effectiveRangeTicks,
            newTickLower,
            newTickUpper,
            rebalanceNeeded,
          },
          actionTaken: rebalanceNeeded,
        });
      } catch {
        // Non-critical — ignore logging failures
      }
    } catch (err) {
      console.error(`[strategy] Error processing ${chain}:`, err);
    }
  }
}

export async function snapshotPortfolio(): Promise<void> {
  const positions = getAllPositions();
  const totalCapital = positions.reduce((s, p) => s + p.capitalUsd, 0);
  const totalFees = positions.reduce((s, p) => s + p.feesAccrued, 0);
  const totalGas = positions.reduce((s, p) => s + p.gasSpent, 0);
  const netPnl = totalFees - totalGas;
  const totalValueUsd = totalCapital + totalFees;

  // Calculate rolling APY from oldest open position
  const oldestOpen =
    positions.length > 0
      ? Math.min(...positions.map((p) => p.openedAt.getTime()))
      : Date.now();
  const elapsedHours = (Date.now() - oldestOpen) / (1000 * 3600);
  const initialCapital = CAPITAL_PER_CHAIN * TARGET_POOLS.length;
  const apy =
    elapsedHours > 1 && initialCapital > 0
      ? (netPnl / initialCapital) * (8760 / elapsedHours) * 100
      : 0;

  try {
    await db.insert(portfolioSnapshots).values({
      timestamp: new Date(),
      totalValueUsd,
      totalFeesEarnedUsd: totalFees,
      totalGasSpentUsd: totalGas,
      netPnlUsd: netPnl,
      apyCurrent: apy,
      apy7d: apy,
      apy30d: apy,
      highWaterMarkUsd: totalValueUsd,
      drawdownFromPeakPct: 0, // stablecoin LP — minimal drawdown
      positionCount: positions.length,
    });
    console.log(
      `[strategy] Portfolio snapshot: $${totalValueUsd.toFixed(2)} value, $${totalFees.toFixed(4)} fees, APY ${apy.toFixed(2)}%`,
    );
  } catch (e) {
    console.error("[strategy] Portfolio snapshot failed:", e);
  }
}
