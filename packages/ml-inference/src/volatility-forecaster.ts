import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, "../../../models");

interface GarchParams {
  omega: number;
  alpha: number;
  beta: number;
  nu: number;
  unconditional_vol_bps: number;
}

interface RangeConfig {
  base_ticks: number;
  vol_multiplier: number;
  min_ticks: number;
  max_ticks: number;
  stress_threshold_bps: number;
  stress_multiplier: number;
  depeg_threshold: number;
}

interface GarchState {
  sigma2: number;
  lastReturn: number;
}

// In-memory GARCH state per pool
const garchStates = new Map<string, GarchState>();

let garchParams: GarchParams | null = null;
let rangeConfig: RangeConfig | null = null;

function loadParams() {
  if (garchParams) return;
  const paramsPath = path.join(MODELS_DIR, "garch_params.json");
  if (!fs.existsSync(paramsPath)) {
    garchParams = {
      omega: 0.01,
      alpha: 0.1,
      beta: 0.85,
      nu: 10.0,
      unconditional_vol_bps: 0.5,
    };
    rangeConfig = {
      base_ticks: 3,
      vol_multiplier: 5.0,
      min_ticks: 1,
      max_ticks: 50,
      stress_threshold_bps: 2.0,
      stress_multiplier: 3.0,
      depeg_threshold: 0.3,
    };
    return;
  }
  const data = JSON.parse(fs.readFileSync(paramsPath, "utf-8"));
  garchParams = data.garch;
  rangeConfig = data.range_config;
}

/**
 * Update GARCH state with new tick observation and return sigma (bps/hr).
 */
export function updateGarchVol(
  poolKey: string,
  currentTick: number,
  prevTick: number,
): number {
  loadParams();
  const { omega, alpha, beta, unconditional_vol_bps } = garchParams!;
  const unconditional_var = unconditional_vol_bps ** 2;

  let state = garchStates.get(poolKey);
  if (!state) {
    state = { sigma2: unconditional_var, lastReturn: 0 };
    garchStates.set(poolKey, state);
  }

  // Log return in basis points
  const tickReturn =
    prevTick !== 0 ? (currentTick - prevTick) * Math.log(1.0001) * 10000 : 0;

  // GARCH(1,1) update
  const newSigma2 = omega + alpha * tickReturn ** 2 + beta * state.sigma2;
  state.sigma2 = newSigma2;
  state.lastReturn = tickReturn;
  garchStates.set(poolKey, state);

  return Math.sqrt(Math.max(newSigma2, 1e-12));
}

/**
 * Compute optimal tick range half-width from current volatility.
 * Returns number of ticks for half the range (tick_lower = current - result, tick_upper = current + result)
 */
export function computeRangeTicks(
  volBps: number,
  depegProb: number = 0,
): number {
  loadParams();
  const cfg = rangeConfig!;

  // Switch to stress regime?
  const inStress =
    volBps > cfg.stress_threshold_bps || depegProb > cfg.depeg_threshold;
  const multiplier = inStress ? cfg.stress_multiplier : 1.0;

  const halfRange =
    cfg.base_ticks + Math.ceil(volBps * cfg.vol_multiplier * multiplier);
  return Math.max(cfg.min_ticks, Math.min(cfg.max_ticks, halfRange));
}

export function getCurrentVol(poolKey: string): number {
  loadParams();
  const state = garchStates.get(poolKey);
  if (!state) return garchParams!.unconditional_vol_bps;
  return Math.sqrt(state.sigma2);
}
