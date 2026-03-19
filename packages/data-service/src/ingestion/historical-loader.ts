/**
 * Historical data backfill — pulls 6 months of poolHourData from The Graph
 * and stores it in the feature store. Run once on setup, then rely on live streaming.
 */

import { db } from "../db/index.js";
import { poolHourData } from "../db/schema.js";
import { fetchPoolHourData } from "../scanner/subgraph-client.js";
import { TARGET_POOLS } from "@lp-engine/shared";
import { sql } from "drizzle-orm";

export async function backfillHistoricalData(
  monthsBack: number = 6,
): Promise<void> {
  const startTime = new Date();
  startTime.setMonth(startTime.getMonth() - monthsBack);

  console.log(
    `[historical-loader] Backfilling ${monthsBack} months of data from ${startTime.toISOString()}`,
  );
  console.log(`[historical-loader] Targeting ${TARGET_POOLS.length} pools`);

  for (const pool of TARGET_POOLS) {
    console.log(
      `\n[historical-loader] ${pool.chain} ${pool.token0Symbol}/${pool.token1Symbol} (${pool.address})`,
    );

    // Check existing data
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(poolHourData)
      .where(
        sql`chain = ${pool.chain} AND pool_address = ${pool.address.toLowerCase()}`,
      );

    const existingCount = Number(existing[0]?.count || 0);
    console.log(`[historical-loader]   Existing rows: ${existingCount}`);

    try {
      const data = await fetchPoolHourData(pool.chain, pool.address, startTime);
      console.log(
        `[historical-loader]   Fetched ${data.length} hourly data points`,
      );

      if (data.length === 0) {
        console.warn(
          `[historical-loader]   No data returned — pool may not be in subgraph`,
        );
        continue;
      }

      // Batch insert in chunks of 500
      const chunkSize = 500;
      let inserted = 0;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await db
          .insert(poolHourData)
          .values(
            chunk.map((row) => ({
              chain: pool.chain,
              poolAddress: pool.address.toLowerCase(),
              hourTimestamp: row.timestamp,
              volumeUsd: row.volumeUsd,
              feeUsd: row.feeUsd,
              tvlUsd: row.tvlUsd,
              tick: row.tick,
              sqrtPriceX96: row.sqrtPriceX96,
              liquidity: row.liquidity,
              txCount: row.txCount,
              openTick: row.openTick,
              closeTick: row.closeTick,
              highTick: row.highTick,
              lowTick: row.lowTick,
            })),
          )
          .onConflictDoNothing();
        inserted += chunk.length;
        process.stdout.write(
          `\r[historical-loader]   Inserted ${inserted}/${data.length}`,
        );
      }
      console.log(`\n[historical-loader]   Done`);
    } catch (err) {
      console.error(`[historical-loader]   ERROR: ${err}`);
    }

    // Be nice to The Graph
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Count total rows
  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(poolHourData);
  console.log(
    `\n[historical-loader] Total pool_hour_data rows: ${Number(total[0]?.count || 0)}`,
  );
}
