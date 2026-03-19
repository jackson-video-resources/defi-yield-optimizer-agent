/**
 * Feature builder — computes all ML features from raw pool data.
 * Features are designed to predict pool volume and fee generation.
 *
 * 14 features total:
 * 1-4:   hour_of_day (sin/cos), day_of_week (sin/cos) — cyclical temporal
 * 5-8:   volume lags (1h, 4h, 24h, 7d)
 * 9:     volume rolling mean 24h
 * 10:    CEX volume ratio (Binance volume / pool rolling mean)
 * 11:    realized volatility 4h (from tick movements)
 * 12:    gas price in gwei
 * 13:    pool TVL (log-transformed)
 * 14:    large swap count (swaps > $50K in last hour)
 */

import { db } from "../db/index.js";
import {
  poolHourData,
  featureStore,
  cexVolumeSnapshots,
  swapEvents,
} from "../db/schema.js";
import { sql, and, gte, lte, eq } from "drizzle-orm";
import type { Chain } from "@lp-engine/shared";
import type { FeatureRow } from "@lp-engine/shared";

export async function computeFeatures(
  chain: Chain,
  poolAddress: string,
  atTime: Date,
): Promise<FeatureRow | null> {
  const normalizedPool = poolAddress.toLowerCase();

  // Get 7d of hourly data for lag features
  const sevenDaysAgo = new Date(atTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const history = await db
    .select()
    .from(poolHourData)
    .where(
      and(
        eq(poolHourData.chain, chain),
        eq(poolHourData.poolAddress, normalizedPool),
        gte(poolHourData.hourTimestamp, sevenDaysAgo),
        lte(poolHourData.hourTimestamp, atTime),
      ),
    )
    .orderBy(poolHourData.hourTimestamp);

  if (history.length < 24) return null; // Need at least 24h of data

  // Current row is the most recent
  const current = history[history.length - 1];

  // Helper: find row N hours ago
  const hoursAgo = (n: number) => {
    const t = new Date(atTime.getTime() - n * 60 * 60 * 1000);
    return history.find(
      (r) => Math.abs(r.hourTimestamp.getTime() - t.getTime()) < 30 * 60 * 1000,
    );
  };

  const row1h = hoursAgo(1);
  const row4h = hoursAgo(4);
  const row24h = hoursAgo(24);
  const row7d = hoursAgo(168);

  // Rolling mean of last 24h
  const last24h = history.slice(-24);
  const volumeRollingMean24h =
    last24h.reduce((s, r) => s + r.volumeUsd, 0) / last24h.length;

  // CEX volume ratio
  const cexRow = await db
    .select()
    .from(cexVolumeSnapshots)
    .where(
      and(
        eq(cexVolumeSnapshots.pair, "USDT/USDC"),
        eq(cexVolumeSnapshots.exchange, "binance"),
        lte(cexVolumeSnapshots.timestamp, atTime),
      ),
    )
    .orderBy(sql`timestamp desc`)
    .limit(1);

  const cexVolume1h = cexRow[0]?.volume1h || 0;
  const cexVolumeRatio =
    volumeRollingMean24h > 0 ? cexVolume1h / volumeRollingMean24h : 1;

  // Realized volatility (4h): std of log tick returns
  const last4hRows = history.slice(-5);
  let realizedVol4h = 0;
  if (last4hRows.length >= 2) {
    const returns = last4hRows.slice(1).map((r, i) => {
      const prevTick = last4hRows[i].tick;
      return prevTick !== 0 ? Math.log(r.tick / prevTick) : 0;
    });
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance =
      returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    realizedVol4h = Math.sqrt(variance);
  }

  // Large swap count (last hour) — approximate from swap_events table
  const oneHourAgo = new Date(atTime.getTime() - 60 * 60 * 1000);
  const largeSwaps = await db
    .select({ count: sql<number>`count(*)` })
    .from(swapEvents)
    .where(
      and(
        eq(swapEvents.chain, chain),
        eq(swapEvents.poolAddress, normalizedPool),
        gte(swapEvents.timestamp, oneHourAgo),
        lte(swapEvents.timestamp, atTime),
        sql`ABS(CAST(amount_usd AS FLOAT)) > 50000`,
      ),
    );
  const largeSwapCount1h = Number(largeSwaps[0]?.count || 0);

  // Gas price — use a reasonable default since we don't have a live gas oracle yet
  const gasPriceGwei = 0.1; // L2 typical gas price

  // Temporal cyclical encodings
  const hour = atTime.getUTCHours();
  const dayOfWeek = atTime.getUTCDay();

  return {
    poolAddress: normalizedPool,
    chain,
    timestamp: atTime,
    hourOfDaySin: Math.sin((2 * Math.PI * hour) / 24),
    hourOfDayCos: Math.cos((2 * Math.PI * hour) / 24),
    dayOfWeekSin: Math.sin((2 * Math.PI * dayOfWeek) / 7),
    dayOfWeekCos: Math.cos((2 * Math.PI * dayOfWeek) / 7),
    volumeLag1h: row1h?.volumeUsd || 0,
    volumeLag4h: row4h?.volumeUsd || 0,
    volumeLag24h: row24h?.volumeUsd || 0,
    volumeLag7d: row7d?.volumeUsd || 0,
    volumeRollingMean24h,
    cexVolumeRatio,
    realizedVol4h,
    gasPriceGwei,
    poolTvlLog: current.tvlUsd > 0 ? Math.log(current.tvlUsd) : 0,
    largeSwapCount1h,
    feeTier: 100, // Default to 0.01% for stablecoin pools
  };
}

/**
 * Compute and store features for all target pools at the current hour.
 */
export async function updateFeatureStore(
  chain: Chain,
  poolAddress: string,
): Promise<void> {
  const now = new Date();
  // Round to current hour
  now.setMinutes(0, 0, 0);

  const features = await computeFeatures(chain, poolAddress, now);
  if (!features) {
    console.warn(
      `[feature-builder] Insufficient data for ${chain}:${poolAddress}`,
    );
    return;
  }

  await db
    .insert(featureStore)
    .values({
      poolAddress: poolAddress.toLowerCase(),
      chain,
      timestamp: now,
      features: features as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing();
}
