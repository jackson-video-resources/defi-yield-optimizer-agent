import { loadModel, runInference } from "./onnx-runtime.js";
import type { FeatureRow, Chain } from "@lp-engine/shared";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "../../../models");

interface VolumeStats {
  mean: number[];
  std: number[];
}

const statsCache = new Map<Chain, VolumeStats>();

function loadStats(chain: Chain): VolumeStats {
  if (statsCache.has(chain)) return statsCache.get(chain)!;
  const statsPath = path.join(MODELS_DIR, `volume_stats_${chain}.json`);
  if (!fs.existsSync(statsPath)) {
    // Return identity normalization if no stats file
    return { mean: new Array(14).fill(0), std: new Array(14).fill(1) };
  }
  const stats = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
  statsCache.set(chain, stats);
  return stats;
}

function featureRowToArray(features: FeatureRow): number[] {
  return [
    features.hourOfDaySin,
    features.hourOfDayCos,
    features.dayOfWeekSin,
    features.dayOfWeekCos,
    features.volumeLag1h,
    features.volumeLag4h,
    features.volumeLag24h,
    features.volumeLag7d,
    features.volumeRollingMean24h,
    features.cexVolumeRatio,
    features.realizedVol4h,
    features.gasPriceGwei,
    features.poolTvlLog,
    features.largeSwapCount1h,
  ];
}

export async function predictVolume4h(
  features: FeatureRow,
  chain: Chain,
): Promise<number> {
  const modelName = `volume_lgb_${chain}.onnx`;
  const session = await loadModel(modelName);

  const featureArray = featureRowToArray(features);
  const input = new Float32Array(featureArray);
  const output = await runInference(session, input);

  // Model predicts log(volume), convert back
  const logVolume = output[0];
  return Math.exp(logVolume);
}
