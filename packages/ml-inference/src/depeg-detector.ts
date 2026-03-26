import { loadModel, runInference } from "./onnx-runtime.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "../../../models");

interface DepegConfig {
  thresholds: { alert: number; widen: number; exit: number };
  stablecoins: string[];
}

let depegConfig: DepegConfig | null = null;

function loadConfig() {
  if (depegConfig) return;
  const configPath = path.join(MODELS_DIR, "depeg_config.json");
  if (fs.existsSync(configPath)) {
    depegConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } else {
    depegConfig = {
      thresholds: { alert: 0.1, widen: 0.3, exit: 0.7 },
      stablecoins: ["USDC", "USDT", "DAI", "USDe", "USDbC"],
    };
  }
}

// Track consecutive exit signals
const exitSignalCount = new Map<string, number>();

export async function computeDepegProbability(
  pegDeviations: Record<string, number>,
): Promise<number> {
  loadConfig();

  const stablecoins = depegConfig!.stablecoins;
  const devs = stablecoins.map((s) => pegDeviations[s] || 0);
  const maxDev = Math.max(...devs);
  const avgDev = devs.reduce((a, b) => a + b, 0) / devs.length;
  const nDeviating = devs.filter((d) => d > 0.1).length;
  const maxDev24h = maxDev; // simplified — no 24h history here
  const devChange1h = 0; // simplified

  const features = new Float32Array([
    maxDev,
    avgDev,
    devChange1h,
    maxDev24h,
    nDeviating,
  ]);

  try {
    const session = await loadModel("depeg_iforest.onnx");
    const output = await runInference(session, features);
    // output[0] is decision_function score, convert to probability
    const score = output[0];
    return 1 / (1 + Math.exp(score * 5));
  } catch {
    // If model fails, use rule-based fallback
    return maxDev > 1.0 ? 0.8 : maxDev > 0.5 ? 0.4 : maxDev > 0.1 ? 0.1 : 0.01;
  }
}

export function getDepegAction(
  prob: number,
  poolKey: string,
): "none" | "alert" | "widen" | "exit" {
  loadConfig();
  const { alert, widen, exit } = depegConfig!.thresholds;

  if (prob > exit) {
    const count = (exitSignalCount.get(poolKey) || 0) + 1;
    exitSignalCount.set(poolKey, count);
    return count >= 3 ? "exit" : "widen";
  }

  // Reset exit counter
  exitSignalCount.set(poolKey, 0);

  if (prob > widen) return "widen";
  if (prob > alert) return "alert";
  return "none";
}
