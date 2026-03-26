export interface DrawdownState {
  currentValueUsd: number;
  highWaterMarkUsd: number;
  drawdownPct: number;
  drawdownUsd: number;
  feesEarnedTotal: number;
  gasSpentTotal: number;
  netPnlUsd: number;
  gasSpentToday: number;
  lastUpdated: string;
}

let state: DrawdownState = {
  currentValueUsd: 0,
  highWaterMarkUsd: 0,
  drawdownPct: 0,
  drawdownUsd: 0,
  feesEarnedTotal: 0,
  gasSpentTotal: 0,
  netPnlUsd: 0,
  gasSpentToday: 0,
  lastUpdated: new Date().toISOString(),
};

// Reset daily gas tracking at midnight UTC
let lastDayReset = new Date().toDateString();

let initialized = false;

export function updateDrawdown(
  currentValueUsd: number,
  feesEarned: number,
  gasSpent: number,
): DrawdownState {
  // Reset daily gas counter
  const today = new Date().toDateString();
  if (today !== lastDayReset) {
    state.gasSpentToday = 0;
    lastDayReset = today;
  }

  state.currentValueUsd = currentValueUsd;
  state.feesEarnedTotal = feesEarned;
  state.gasSpentTotal = gasSpent;
  state.gasSpentToday += 0; // incremented per-tx by addGasSpend
  state.netPnlUsd = feesEarned - gasSpent;

  // Set HWM from first observed value so we don't get false drawdowns at startup
  if (!initialized || currentValueUsd > state.highWaterMarkUsd) {
    state.highWaterMarkUsd = currentValueUsd;
    initialized = true;
  }

  if (state.highWaterMarkUsd > 0) {
    state.drawdownUsd = state.highWaterMarkUsd - currentValueUsd;
    state.drawdownPct = (state.drawdownUsd / state.highWaterMarkUsd) * 100;
  }

  state.lastUpdated = new Date().toISOString();
  return { ...state };
}

export function addGasSpend(usd: number): void {
  const today = new Date().toDateString();
  if (today !== lastDayReset) {
    state.gasSpentToday = 0;
    lastDayReset = today;
  }
  state.gasSpentToday += usd;
}

export function getDrawdownState(): DrawdownState {
  return { ...state };
}

export function initDrawdown(_initialCapital: number): void {
  // HWM is set from first observed portfolio value, not from config
  initialized = false;
}
