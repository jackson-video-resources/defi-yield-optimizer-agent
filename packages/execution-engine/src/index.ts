import "dotenv/config";
import express from "express";
import {
  runStrategyTick,
  snapshotPortfolio,
} from "./strategy/strategy-engine.js";
import {
  getAllPositions,
  closePaperPosition,
  isInRange,
  loadPositionsFromDB,
} from "./position/paper-position.js";
import { db } from "./db/index.js";
import {
  poolHourData,
  portfolioSnapshots,
  aiDecisions,
  stablecoinPegSnapshots,
} from "./db/schema.js";
import { desc, eq } from "drizzle-orm";
import type { Chain } from "@lp-engine/shared";

const app = express();
const PORT = parseInt(process.env.PORT_EXECUTION || process.env.PORT || "4003");
const PAPER_TRADING = process.env.PAPER_TRADING !== "false";

app.use(express.json());

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    service: "execution-engine",
    paperTrading: PAPER_TRADING,
    timestamp: new Date().toISOString(),
  });
});

app.get("/positions", async (_, res) => {
  const rawPositions = getAllPositions();

  // Fetch latest tick per chain from DB
  const chains = [...new Set(rawPositions.map((p) => p.chain as Chain))];
  const tickMap = new Map<string, number>();
  for (const chain of chains) {
    try {
      const rows = await db
        .select()
        .from(poolHourData)
        .where(eq(poolHourData.chain, chain))
        .orderBy(desc(poolHourData.hourTimestamp))
        .limit(1);
      if (rows.length) tickMap.set(chain, rows[0].tick);
    } catch {
      // ignore — falls back to midpoint
    }
  }

  const positions = rawPositions.map((p) => {
    const currentTick =
      tickMap.get(p.chain) ?? Math.round((p.tickLower + p.tickUpper) / 2);
    return {
      id: p.id,
      chain: p.chain,
      poolAddress: p.poolAddress,
      token0Symbol: "USDC",
      token1Symbol: "USDT",
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      currentTick,
      inRange: isInRange(p, currentTick),
      feesEarnedUsd: p.feesAccrued,
      capitalUsd: p.capitalUsd,
      openedAt: p.openedAt.toISOString(),
    };
  });

  res.json({ positions });
});

app.get("/portfolio", async (_, res) => {
  try {
    const snapshots = await db
      .select()
      .from(portfolioSnapshots)
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(500);

    const mapped = snapshots.map((s) => ({
      timestamp: s.timestamp.toISOString(),
      totalValueUsd: s.totalValueUsd,
      feesEarnedUsd: s.totalFeesEarnedUsd,
      gasSpentUsd: s.totalGasSpentUsd,
      netPnlUsd: s.netPnlUsd,
      apyCurrent: s.apyCurrent ?? 0,
      apy7d: s.apy7d ?? 0,
      apy30d: s.apy30d ?? 0,
      highWaterMark: s.highWaterMarkUsd,
      drawdownPct: s.drawdownFromPeakPct,
    }));

    // Sort ascending for chart; first element is latest
    const sorted = [...mapped].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
    const latest = mapped[0] ?? null;

    res.json({ snapshots: sorted, latest });
  } catch (err) {
    res.json({ snapshots: [], latest: null });
  }
});

app.get("/ai-decisions", async (_, res) => {
  try {
    const rows = await db
      .select()
      .from(aiDecisions)
      .orderBy(desc(aiDecisions.timestamp))
      .limit(100);

    const decisions = rows.map((d) => ({
      id: String(d.id),
      timestamp: d.timestamp.toISOString(),
      decisionType: d.decisionType,
      chain: d.chain ?? "",
      poolAddress: d.poolAddress ?? "",
      reasoning: d.reasoning ?? "",
      outcomeUsd: d.outcomeUsd ?? 0,
    }));

    res.json({ decisions });
  } catch (err) {
    res.json({ decisions: [] });
  }
});

app.get("/qhvn-benchmark", async (_, res) => {
  // Build synthetic QHVN benchmark data from stablecoin peg snapshots
  // QHVN strategy: fixed 4h rebalance. We model as constant -41.56% APY over backtest period.
  // For live period we extrapolate from start date.
  try {
    const rows = await db
      .select()
      .from(stablecoinPegSnapshots)
      .orderBy(stablecoinPegSnapshots.timestamp)
      .limit(200);

    if (!rows.length) {
      res.json({ data: [] });
      return;
    }

    // Produce one data point per day using the known QHVN APY of -41.56%
    const QHVN_DAILY_RETURN = -41.56 / 365;
    const seenDates = new Set<string>();
    const data: {
      date: string;
      cumulativeReturnPct: number;
      dailyReturnPct: number;
    }[] = [];
    let dayIndex = 0;

    for (const row of rows) {
      const date = row.timestamp.toISOString().split("T")[0];
      if (seenDates.has(date)) continue;
      seenDates.add(date);
      const cumulativeReturnPct = QHVN_DAILY_RETURN * dayIndex;
      data.push({
        date,
        cumulativeReturnPct,
        dailyReturnPct: QHVN_DAILY_RETURN,
      });
      dayIndex++;
    }

    res.json({ data });
  } catch {
    res.json({ data: [] });
  }
});

app.post("/tick", async (_, res) => {
  try {
    await runStrategyTick();
    res.json({ message: "Tick executed", positions: getAllPositions().length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/positions/close-all", (req, res) => {
  const reason = req.body?.reason || "Emergency exit";
  const positions = getAllPositions();
  positions.forEach((p) => closePaperPosition(p.id));
  console.log(
    `[execution-engine] Closed ${positions.length} positions: ${reason}`,
  );
  res.json({ closed: positions.length, reason });
});

app.listen(PORT, () => {
  console.log(`[execution-engine] Running on port ${PORT}`);
  console.log(`[execution-engine] Paper trading: ${PAPER_TRADING}`);
});

// Start strategy loop
async function startLoop(): Promise<void> {
  console.log("[execution-engine] Starting strategy loop...");

  // Restore paper positions from DB before first tick
  await loadPositionsFromDB();

  // Run initial tick immediately on startup
  await runStrategyTick().catch(console.error);

  // Main loop: every 60 seconds
  setInterval(() => {
    runStrategyTick().catch(console.error);
  }, 60_000);

  // Portfolio snapshot: every 5 minutes
  setInterval(() => {
    snapshotPortfolio().catch(console.error);
  }, 5 * 60_000);
}

startLoop();
