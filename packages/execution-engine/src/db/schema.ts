import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  timestamp,
  serial,
  varchar,
  index,
} from "drizzle-orm/pg-core";

// ── Feature Store (read-only from execution-engine) ────────────────────────────

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
    index("phd_pool_time_idx_exec").on(t.chain, t.poolAddress, t.hourTimestamp),
  ],
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
  (t) => [index("peg_symbol_time_idx_exec").on(t.symbol, t.timestamp)],
);

// ── Execution ──────────────────────────────────────────────────────────────────

export const lpPositions = pgTable(
  "lp_positions",
  {
    id: text("id").primaryKey(), // UUID / paper ID
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
  (t) => [index("pos_chain_status_idx_exec").on(t.chain, t.status)],
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
  outcomeUsd: doublePrecision("outcome_usd"),
});
