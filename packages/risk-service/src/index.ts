import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { checkPegStatus } from "./depeg-sentinel.js";
import {
  evaluateKillSwitch,
  isKillSwitchActive,
  resetKillSwitch,
} from "./kill-switch.js";
import {
  updateDrawdown,
  getDrawdownState,
  initDrawdown,
  addGasSpend,
} from "./drawdown-monitor.js";
import { emergencyExit } from "./circuit-breaker.js";
import { sendAlert } from "./alerts.js";

const PORT = 4004;
const EXECUTION_ENGINE_URL =
  process.env.EXECUTION_ENGINE_URL || "http://localhost:4003";
const INITIAL_CAPITAL = parseFloat(process.env.INITIAL_CAPITAL || "10000");
const GAS_BUDGET_USD = parseFloat(process.env.GAS_BUDGET_USD || "20");

const app = express();
app.use(express.json());

// Health
app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    service: "risk-service",
    killSwitchActive: isKillSwitchActive(),
    timestamp: new Date().toISOString(),
  });
});

// Kill switch status
app.get("/kill-switch", (_, res) => {
  res.json({ active: isKillSwitchActive() });
});

// Manual kill switch
app.post("/kill-switch/activate", (req, res) => {
  const reason = req.body.reason || "Manual activation";
  writeFileSync(join(__dirname, "../../../.kill-switch"), reason);
  res.json({ activated: true, reason });
});

app.post("/kill-switch/reset", (_, res) => {
  resetKillSwitch();
  res.json({ reset: true });
});

// Drawdown state
app.get("/drawdown", (_, res) => {
  res.json(getDrawdownState());
});

// Depeg status endpoint
app.get("/depeg", async (_, res) => {
  try {
    const result = await checkPegStatus();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Add gas spend (called by execution engine after each tx)
app.post("/gas-spend", (req, res) => {
  const { usd } = req.body;
  if (typeof usd === "number") addGasSpend(usd);
  res.json({ ok: true });
});

// Initialize drawdown tracking
initDrawdown(INITIAL_CAPITAL);

// Depeg check every 5 minutes
async function runDepegCheck() {
  try {
    const result = await checkPegStatus();

    if (result.action === "exit") {
      console.log(
        `[risk] Depeg exit signal — ${result.dangerCount} coins in danger`,
      );
      await emergencyExit(
        `Depeg detected: ${result.statuses
          .filter((s) => s.status === "danger")
          .map((s) => s.symbol)
          .join(", ")}`,
      );
    } else if (result.action === "widen") {
      console.log(
        `[risk] Depeg widen signal — max deviation ${result.maxDeviation.toFixed(3)}%`,
      );
      await sendAlert(
        `Peg deviation detected: max ${result.maxDeviation.toFixed(3)}%. Widening ranges.`,
        "warning",
      );
    }

    // Worst deviation above 0.1% → alert
    if (result.maxDeviation > 0.1 && result.action === "none") {
      console.log(
        `[risk] Peg alert: max deviation ${result.maxDeviation.toFixed(3)}%`,
      );
    }
  } catch (err) {
    console.error("[risk] Depeg check error:", err);
  }
}

// Portfolio snapshot every 60s
async function runPortfolioCheck() {
  try {
    const res = await fetch(`${EXECUTION_ENGINE_URL}/portfolio`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;

    const portfolio = (await res.json()) as any;
    const snapshot = portfolio.latest;
    if (!snapshot) return;

    // Skip drawdown evaluation if portfolio is empty (positions just closed or not yet open)
    if (!snapshot.totalValueUsd || snapshot.totalValueUsd < 1) return;

    const drawdown = updateDrawdown(
      snapshot.totalValueUsd,
      snapshot.feesEarnedUsd || 0,
      snapshot.gasSpentUsd || 0,
    );

    // Evaluate kill switch
    const ksResult = evaluateKillSwitch({
      drawdownPct: drawdown.drawdownPct,
      gasSpentToday: drawdown.gasSpentToday,
      gasBudgetUsd: GAS_BUDGET_USD,
      depegDetected: false, // handled by depeg check
      consecutiveRebalanceFails: 0, // TODO: track in execution engine
      netPnlUsd: drawdown.netPnlUsd,
    });

    if (ksResult.active && ksResult.reason) {
      console.log(`[risk] Kill switch triggered: ${ksResult.reason}`);
      await emergencyExit(ksResult.reason);
    }

    if (drawdown.drawdownPct > 0.5) {
      console.log(`[risk] Drawdown: ${drawdown.drawdownPct.toFixed(3)}%`);
    }
  } catch (err) {
    // Execution engine may not be running yet
  }
}

// Start loops
setInterval(runDepegCheck, 5 * 60 * 1000); // Every 5 min
setInterval(runPortfolioCheck, 60 * 1000); // Every 60s

// Run immediately
runDepegCheck();
runPortfolioCheck();

app.listen(PORT, () => {
  console.log(`[risk-service] Running on port ${PORT}`);
  console.log(`[risk-service] Gas budget: $${GAS_BUDGET_USD}/day`);
});
