import "dotenv/config";
import express from "express";
import { predictVolume4h } from "./volume-predictor.js";
import {
  updateGarchVol,
  computeRangeTicks,
  getCurrentVol,
} from "./volatility-forecaster.js";
import { computeDepegProbability, getDepegAction } from "./depeg-detector.js";
import type { Chain } from "@lp-engine/shared";

const app = express();
const PORT = parseInt(process.env.PORT_ML || process.env.PORT || "4002");

app.use(express.json());

app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    service: "ml-inference",
    timestamp: new Date().toISOString(),
  });
});

// POST /predict/volume
// Body: { chain, features: FeatureRow }
// Returns: { predictedVolume4h: number }
app.post("/predict/volume", async (req, res) => {
  try {
    const { chain, features } = req.body;
    const volume = await predictVolume4h(features, chain as Chain);
    res.json({ predictedVolume4h: volume });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /predict/volatility
// Body: { poolKey, currentTick, prevTick, depegProb? }
// Returns: { volBps, rangeTicks }
app.post("/predict/volatility", (req, res) => {
  try {
    const { poolKey, currentTick, prevTick, depegProb = 0 } = req.body;
    const volBps = updateGarchVol(poolKey, currentTick, prevTick);
    const rangeTicks = computeRangeTicks(volBps, depegProb);
    res.json({ volBps, rangeTicks });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /predict/volatility/:poolKey
// Returns current vol estimate without updating
app.get("/predict/volatility/:poolKey", (req, res) => {
  try {
    const volBps = getCurrentVol(req.params.poolKey);
    const rangeTicks = computeRangeTicks(volBps);
    res.json({ volBps, rangeTicks });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /predict/depeg
// Body: { deviations: Record<string, number> }  e.g. { USDC: 0.02, USDT: 0.01 }
// Returns: { probability, action, stablecoins }
app.post("/predict/depeg", async (req, res) => {
  try {
    const { deviations, poolKey = "default" } = req.body;
    const probability = await computeDepegProbability(deviations);
    const action = getDepegAction(probability, poolKey);
    res.json({ probability, action, deviations });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`[ml-inference] Running on port ${PORT}`);
  console.log(`[ml-inference] Health: http://localhost:${PORT}/health`);
});
