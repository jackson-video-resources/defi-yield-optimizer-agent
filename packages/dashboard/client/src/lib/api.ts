const BASE = "/api";

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface PortfolioSnapshot {
  timestamp: string;
  totalValueUsd: number;
  feesEarnedUsd: number;
  gasSpentUsd: number;
  netPnlUsd: number;
  apyCurrent: number;
  apy7d: number;
  apy30d: number;
  highWaterMark: number;
  drawdownPct: number;
}

export interface Position {
  id: string;
  chain: string;
  poolAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  inRange: boolean;
  feesEarnedUsd: number;
  capitalUsd: number;
  openedAt: string;
}

export interface AIDecision {
  id: string;
  timestamp: string;
  decisionType: string;
  chain: string;
  poolAddress: string;
  reasoning: string;
  outcomeUsd: number;
}

export interface QhvnBenchmark {
  date: string;
  cumulativeReturnPct: number;
  dailyReturnPct: number;
}
