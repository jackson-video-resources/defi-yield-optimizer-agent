import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  serial,
  varchar,
  index,
} from "drizzle-orm/pg-core";

// ── Feature Store ──────────────────────────────────────────────────────────────

export const poolHourData = pgTable(
  "pool_hour_data",
  {
    id: serial("id").primaryKey(),
    chain: varchar("chain", { length: 20 }).notNull(),
    poolAddress: varchar("pool_address", { length: 42 }).notNull(),
    hourTimestamp: timestamp("hour_timestamp").notNull(),
    volumeUsd: doublePrecision("volume_usd").notNull().default(0),
    feeUsd: doublePrecision("fee_usd").notNull().default(0),
    tvlUsd: doublePrecision("tvl_usd").notNull().default(0),
    tick: integer("tick").notNull().default(0),
    sqrtPriceX96: text("sqrt_price_x96").notNull().default("0"),
    liquidity: text("liquidity").notNull().default("0"),
    txCount: integer("tx_count").notNull().default(0),
    openTick: integer("open_tick"),
    closeTick: integer("close_tick"),
    highTick: integer("high_tick"),
    lowTick: integer("low_tick"),
  },
  (t) => [
    index("phd_pool_time_idx").on(t.chain, t.poolAddress, t.hourTimestamp),
  ],
);

export const swapEvents = pgTable(
  "swap_events",
  {
    id: serial("id").primaryKey(),
    chain: varchar("chain", { length: 20 }).notNull(),
    poolAddress: varchar("pool_address", { length: 42 }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    timestamp: timestamp("timestamp").notNull(),
    amount0: text("amount0").notNull(),
    amount1: text("amount1").notNull(),
    sqrtPriceX96: text("sqrt_price_x96").notNull(),
    tick: integer("tick").notNull(),
    amountUsd: doublePrecision("amount_usd"),
    feeUsd: doublePrecision("fee_usd"),
  },
  (t) => [
    index("swap_pool_time_idx").on(t.chain, t.poolAddress, t.timestamp),
    index("swap_hash_idx").on(t.txHash),
  ],
);

export const cexVolumeSnapshots = pgTable(
  "cex_volume_snapshots",
  {
    id: serial("id").primaryKey(),
    pair: varchar("pair", { length: 20 }).notNull(),
    exchange: varchar("exchange", { length: 20 }).notNull(),
    timestamp: timestamp("timestamp").notNull(),
    volume1h: doublePrecision("volume_1h").notNull().default(0),
    volume24h: doublePrecision("volume_24h").notNull().default(0),
    price: doublePrecision("price").notNull().default(1),
    bidDepth: doublePrecision("bid_depth"),
    askDepth: doublePrecision("ask_depth"),
  },
  (t) => [index("cex_pair_time_idx").on(t.pair, t.exchange, t.timestamp)],
);

export const stablecoinPegSnapshots = pgTable(
  "stablecoin_peg_snapshots",
  {
    id: serial("id").primaryKey(),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    timestamp: timestamp("timestamp").notNull(),
    price: doublePrecision("price").notNull(),
    curvePoolRatio: doublePrecision("curve_pool_ratio"),
    bridgeOutflow1h: doublePrecision("bridge_outflow_1h"),
    bridgeOutflow24h: doublePrecision("bridge_outflow_24h"),
    deviationPct: doublePrecision("deviation_pct").notNull().default(0),
  },
  (t) => [index("peg_symbol_time_idx").on(t.symbol, t.timestamp)],
);

export const featureStore = pgTable(
  "feature_store",
  {
    id: serial("id").primaryKey(),
    poolAddress: varchar("pool_address", { length: 42 }).notNull(),
    chain: varchar("chain", { length: 20 }).notNull(),
    timestamp: timestamp("timestamp").notNull(),
    features: jsonb("features").notNull(),
  },
  (t) => [
    index("feature_pool_time_idx").on(t.poolAddress, t.chain, t.timestamp),
  ],
);

// ── Execution ──────────────────────────────────────────────────────────────────

export const lpPositions = pgTable(
  "lp_positions",
  {
    id: text("id").primaryKey(), // UUID
    chain: varchar("chain", { length: 20 }).notNull(),
    poolAddress: varchar("pool_address", { length: 42 }).notNull(),
    tokenId: integer("token_id"), // NFT id from NPM (null for paper)
    tickLower: integer("tick_lower").notNull(),
    tickUpper: integer("tick_upper").notNull(),
    liquidity: text("liquidity").notNull().default("0"),
    amount0: text("amount0").notNull().default("0"),
    amount1: text("amount1").notNull().default("0"),
    entryTimestamp: timestamp("entry_timestamp").notNull(),
    exitTimestamp: timestamp("exit_timestamp"),
    entryGasCostUsd: doublePrecision("entry_gas_cost_usd").default(0),
    isPaper: boolean("is_paper").notNull().default(true),
    status: varchar("status", { length: 20 }).notNull().default("active"),
  },
  (t) => [index("pos_chain_status_idx").on(t.chain, t.status)],
);

export const rebalanceEvents = pgTable("rebalance_events", {
  id: serial("id").primaryKey(),
  positionId: text("position_id").notNull(),
  chain: varchar("chain", { length: 20 }).notNull(),
  poolAddress: varchar("pool_address", { length: 42 }).notNull(),
  oldTickLower: integer("old_tick_lower").notNull(),
  oldTickUpper: integer("old_tick_upper").notNull(),
  newTickLower: integer("new_tick_lower").notNull(),
  newTickUpper: integer("new_tick_upper").notNull(),
  gasCostUsd: doublePrecision("gas_cost_usd").notNull().default(0),
  feesCollectedUsd: doublePrecision("fees_collected_usd").notNull().default(0),
  reason: text("reason"),
  modelPrediction: jsonb("model_prediction"),
  timestamp: timestamp("timestamp").notNull(),
});

export const feeCollections = pgTable("fee_collections", {
  id: serial("id").primaryKey(),
  positionId: text("position_id").notNull(),
  amount0: text("amount0").notNull(),
  amount1: text("amount1").notNull(),
  usdValue: doublePrecision("usd_value").notNull().default(0),
  compounded: boolean("compounded").notNull().default(false),
  timestamp: timestamp("timestamp").notNull(),
});

export const gasCosts = pgTable("gas_costs", {
  id: serial("id").primaryKey(),
  chain: varchar("chain", { length: 20 }).notNull(),
  txHash: varchar("tx_hash", { length: 66 }),
  gasUsed: bigint("gas_used", { mode: "bigint" }),
  gasPriceGwei: doublePrecision("gas_price_gwei"),
  costEth: doublePrecision("cost_eth"),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  operationType: varchar("operation_type", { length: 30 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
});

// ── Risk & Monitoring ──────────────────────────────────────────────────────────

export const portfolioSnapshots = pgTable("portfolio_snapshots", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull(),
  totalValueUsd: doublePrecision("total_value_usd").notNull().default(0),
  totalFeesEarnedUsd: doublePrecision("total_fees_earned_usd")
    .notNull()
    .default(0),
  totalGasSpentUsd: doublePrecision("total_gas_spent_usd").notNull().default(0),
  netPnlUsd: doublePrecision("net_pnl_usd").notNull().default(0),
  apyCurrent: doublePrecision("apy_current").default(0),
  apy7d: doublePrecision("apy_7d").default(0),
  apy30d: doublePrecision("apy_30d").default(0),
  highWaterMarkUsd: doublePrecision("high_water_mark_usd").notNull().default(0),
  drawdownFromPeakPct: doublePrecision("drawdown_from_peak_pct")
    .notNull()
    .default(0),
  positionCount: integer("position_count").notNull().default(0),
});

export const killSwitchEvents = pgTable("kill_switch_events", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull(),
  condition: varchar("condition", { length: 50 }).notNull(),
  action: varchar("action", { length: 50 }).notNull(),
  description: text("description"),
  portfolioValueAtTrigger: doublePrecision("portfolio_value_at_trigger"),
});

export const depegAlerts = pgTable("depeg_alerts", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  price: doublePrecision("price").notNull(),
  deviationPct: doublePrecision("deviation_pct").notNull(),
  actionTaken: varchar("action_taken", { length: 50 }),
  positionsAffected: jsonb("positions_affected"),
});

export const aiDecisions = pgTable("ai_decisions", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull(),
  decisionType: varchar("decision_type", { length: 20 }).notNull(),
  chain: varchar("chain", { length: 20 }),
  poolAddress: varchar("pool_address", { length: 42 }),
  reasoning: text("reasoning"),
  modelInputs: jsonb("model_inputs"),
  modelOutputs: jsonb("model_outputs"),
  actionTaken: boolean("action_taken").notNull().default(false),
  outcomeUsd: doublePrecision("outcome_usd"), // filled in post-hoc
});

// ── Benchmark ──────────────────────────────────────────────────────────────────

export const qhvnBenchmark = pgTable("qhvn_benchmark", {
  id: serial("id").primaryKey(),
  date: timestamp("date").notNull(),
  cumulativeReturnPct: doublePrecision("cumulative_return_pct").notNull(),
  dailyReturnPct: doublePrecision("daily_return_pct").notNull(),
  apyTrailing30d: doublePrecision("apy_trailing_30d"),
});
