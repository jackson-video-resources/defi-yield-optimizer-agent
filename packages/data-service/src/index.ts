import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { backfillHistoricalData } from "./ingestion/historical-loader.js";
import { updateFeatureStore } from "./features/feature-builder.js";
import { fetchPoolState } from "./scanner/subgraph-client.js";
import { fetchStablecoinCurrentPrices } from "./scanner/defillama-client.js";
import { db } from "./db/index.js";
import { poolHourData, stablecoinPegSnapshots } from "./db/schema.js";
import { TARGET_POOLS, MONITORED_STABLECOINS } from "@lp-engine/shared";
import { sql } from "drizzle-orm";

const app = express();
const PORT = parseInt(process.env.PORT || "4001");

app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    service: "data-service",
    timestamp: new Date().toISOString(),
  });
});

// ── Status endpoints ──────────────────────────────────────────────────────────

app.get("/status", async (_, res) => {
  const rowCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(poolHourData);
  res.json({
    poolHourDataRows: Number(rowCount[0]?.count || 0),
    targetPools: TARGET_POOLS.length,
    timestamp: new Date().toISOString(),
  });
});

app.get("/pools", async (_, res) => {
  const poolStates = await Promise.allSettled(
    TARGET_POOLS.map((p) => fetchPoolState(p.chain, p.address)),
  );
  const states = poolStates.map((r, i) => ({
    pool: TARGET_POOLS[i],
    state: r.status === "fulfilled" ? r.value : null,
    error: r.status === "rejected" ? String(r.reason) : null,
  }));
  res.json(states);
});

app.get("/pegs", async (_, res) => {
  const prices = await fetchStablecoinCurrentPrices().catch(() => ({}));
  res.json(prices);
});

// ── Manual triggers ───────────────────────────────────────────────────────────

app.post("/backfill", async (_, res) => {
  res.json({ message: "Backfill started" });
  backfillHistoricalData(6).catch(console.error);
});

// ── Cron jobs ─────────────────────────────────────────────────────────────────

// Every hour: update features for all pools
cron.schedule("0 * * * *", async () => {
  console.log("[data-service] Running hourly feature update...");
  for (const pool of TARGET_POOLS) {
    await updateFeatureStore(pool.chain, pool.address).catch((e) =>
      console.error(
        `[data-service] Feature update failed for ${pool.address}: ${e}`,
      ),
    );
  }
  console.log("[data-service] Feature update complete");
});

// Every 5 minutes: check stablecoin pegs
cron.schedule("*/5 * * * *", async () => {
  try {
    const prices = await fetchStablecoinCurrentPrices();
    const now = new Date();

    for (const symbol of MONITORED_STABLECOINS) {
      const price = prices[symbol];
      if (price === undefined) continue;

      const deviationPct = Math.abs(price - 1.0) * 100;

      await db.insert(stablecoinPegSnapshots).values({
        symbol,
        timestamp: now,
        price,
        deviationPct,
      });

      if (deviationPct > 0.1) {
        console.warn(
          `[data-service] DEPEG WARNING: ${symbol} = $${price.toFixed(4)} (${deviationPct.toFixed(2)}% deviation)`,
        );
      }
    }
  } catch (err) {
    console.error(`[data-service] Peg monitoring error: ${err}`);
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  // Check DB connection
  try {
    await db.select({ count: sql<number>`count(*)` }).from(poolHourData);
    console.log("[data-service] Database connected");
  } catch (err) {
    console.error("[data-service] Database connection failed:", err);
    process.exit(1);
  }

  // Check if we need to backfill
  const rowCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(poolHourData);
  const existing = Number(rowCount[0]?.count || 0);

  if (existing < 1000) {
    console.log(
      `[data-service] Only ${existing} rows in pool_hour_data — starting backfill...`,
    );
    backfillHistoricalData(6).catch(console.error);
  } else {
    console.log(
      `[data-service] ${existing} rows in pool_hour_data — skipping backfill`,
    );
  }

  app.listen(PORT, () => {
    console.log(`[data-service] Running on port ${PORT}`);
    console.log(`[data-service] Health: http://localhost:${PORT}/health`);
    console.log(`[data-service] Status: http://localhost:${PORT}/status`);
    console.log(`[data-service] Pools: http://localhost:${PORT}/pools`);
  });
}

start();
