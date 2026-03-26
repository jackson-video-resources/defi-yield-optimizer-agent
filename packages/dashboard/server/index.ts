import "dotenv/config";
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "4000");

const EXECUTION_URL =
  process.env.EXECUTION_ENGINE_URL || "http://localhost:4003";
const RISK_URL = process.env.RISK_SERVICE_URL || "http://localhost:4004";
const ML_URL = process.env.ML_SERVICE_URL || "http://localhost:4002";

const app = express();
app.use(express.json());

// Proxy helper
async function proxyGet(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  return res.json();
}

// API routes
app.get("/api/portfolio", async (_, res) => {
  try {
    const data = await proxyGet(`${EXECUTION_URL}/portfolio`);
    res.json(data);
  } catch {
    res.json({ snapshots: [], latest: null });
  }
});

app.get("/api/positions", async (_, res) => {
  try {
    const data = await proxyGet(`${EXECUTION_URL}/positions`);
    res.json(data);
  } catch {
    res.json({ positions: [] });
  }
});

app.get("/api/ai-decisions", async (_, res) => {
  try {
    const data = await proxyGet(`${EXECUTION_URL}/ai-decisions`);
    res.json(data);
  } catch {
    res.json({ decisions: [] });
  }
});

app.get("/api/qhvn-benchmark", async (_, res) => {
  try {
    const data = await proxyGet(`${EXECUTION_URL}/qhvn-benchmark`);
    res.json(data);
  } catch {
    res.json({ data: [] });
  }
});

app.get("/api/depeg", async (_, res) => {
  try {
    const data = await proxyGet(`${RISK_URL}/depeg`);
    res.json(data);
  } catch {
    res.json({ statuses: [], maxDeviation: 0, dangerCount: 0, action: "none" });
  }
});

app.get("/api/drawdown", async (_, res) => {
  try {
    const data = await proxyGet(`${RISK_URL}/drawdown`);
    res.json(data);
  } catch {
    res.json({});
  }
});

app.get("/api/kill-switch", async (_, res) => {
  try {
    const data = await proxyGet(`${RISK_URL}/kill-switch`);
    res.json(data);
  } catch {
    res.json({ active: false });
  }
});

app.get("/api/health", (_, res) => {
  res.json({
    status: "ok",
    service: "dashboard",
    timestamp: new Date().toISOString(),
  });
});

// Serve built React app in production
const distPath = path.resolve(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`[dashboard] Running on port ${PORT}`);
  console.log(
    `[dashboard] Proxying: execution=${EXECUTION_URL}, risk=${RISK_URL}, ml=${ML_URL}`,
  );
});
