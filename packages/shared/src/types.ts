export type Chain = "arbitrum" | "base" | "optimism";

export type PositionStatus = "active" | "closed" | "rebalancing";

export interface Pool {
  address: string;
  chain: Chain;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  feeTier: number; // e.g. 100 = 0.01%
  tickSpacing: number;
}

export interface PoolState {
  pool: Pool;
  currentTick: number;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  volumeUsd24h: number;
  feeUsd24h: number;
  tvlUsd: number;
}

export interface LPPosition {
  id: string;
  chain: Chain;
  poolAddress: string;
  tokenId: number; // NFT id from NonfungiblePositionManager
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
  entryTimestamp: Date;
  isPaper: boolean;
  status: PositionStatus;
}

export interface FeatureRow {
  poolAddress: string;
  chain: Chain;
  timestamp: Date;
  hourOfDaySin: number;
  hourOfDayCos: number;
  dayOfWeekSin: number;
  dayOfWeekCos: number;
  volumeLag1h: number;
  volumeLag4h: number;
  volumeLag24h: number;
  volumeLag7d: number;
  volumeRollingMean24h: number;
  cexVolumeRatio: number;
  realizedVol4h: number;
  gasPriceGwei: number;
  poolTvlLog: number;
  largeSwapCount1h: number;
  feeTier: number;
}

export interface MLPrediction {
  poolAddress: string;
  chain: Chain;
  predictedVolume4h: number;
  predictedVolSigma4h: number;
  depegProbability: number;
  recommendedTickRange: number;
  timestamp: Date;
}

export interface RebalanceDecision {
  shouldRebalance: boolean;
  reason: string;
  newTickLower?: number;
  newTickUpper?: number;
  estimatedGasCostUsd: number;
  expectedBenefitUsd: number;
}

export interface PortfolioSnapshot {
  timestamp: Date;
  totalValueUsd: number;
  totalFeesEarnedUsd: number;
  totalGasSpentUsd: number;
  netPnlUsd: number;
  apyCurrent: number;
  apy7d: number;
  highWaterMarkUsd: number;
  drawdownFromPeakPct: number;
  positionCount: number;
}

export interface DepegAlert {
  symbol: string;
  timestamp: Date;
  price: number;
  deviationPct: number;
  actionTaken: string;
  positionsAffected: string[];
}

export interface AIDecision {
  decisionType: "rebalance" | "allocate" | "exit" | "enter" | "wait";
  chain: Chain;
  poolAddress: string;
  reasoning: string;
  modelInputs: Record<string, unknown>;
  modelOutputs: Record<string, unknown>;
  actionTaken: boolean;
  timestamp: Date;
}
