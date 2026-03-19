CREATE TABLE "ai_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp NOT NULL,
	"decision_type" varchar(20) NOT NULL,
	"chain" varchar(20),
	"pool_address" varchar(42),
	"reasoning" text,
	"model_inputs" jsonb,
	"model_outputs" jsonb,
	"action_taken" boolean DEFAULT false NOT NULL,
	"outcome_usd" double precision
);
--> statement-breakpoint
CREATE TABLE "cex_volume_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"pair" varchar(20) NOT NULL,
	"exchange" varchar(20) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"volume_1h" double precision DEFAULT 0 NOT NULL,
	"volume_24h" double precision DEFAULT 0 NOT NULL,
	"price" double precision DEFAULT 1 NOT NULL,
	"bid_depth" double precision,
	"ask_depth" double precision
);
--> statement-breakpoint
CREATE TABLE "depeg_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"price" double precision NOT NULL,
	"deviation_pct" double precision NOT NULL,
	"action_taken" varchar(50),
	"positions_affected" jsonb
);
--> statement-breakpoint
CREATE TABLE "feature_store" (
	"id" serial PRIMARY KEY NOT NULL,
	"pool_address" varchar(42) NOT NULL,
	"chain" varchar(20) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"features" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" text NOT NULL,
	"amount0" text NOT NULL,
	"amount1" text NOT NULL,
	"usd_value" double precision DEFAULT 0 NOT NULL,
	"compounded" boolean DEFAULT false NOT NULL,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gas_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(20) NOT NULL,
	"tx_hash" varchar(66),
	"gas_used" bigint,
	"gas_price_gwei" double precision,
	"cost_eth" double precision,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"operation_type" varchar(30) NOT NULL,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kill_switch_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp NOT NULL,
	"condition" varchar(50) NOT NULL,
	"action" varchar(50) NOT NULL,
	"description" text,
	"portfolio_value_at_trigger" double precision
);
--> statement-breakpoint
CREATE TABLE "lp_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" varchar(20) NOT NULL,
	"pool_address" varchar(42) NOT NULL,
	"token_id" integer,
	"tick_lower" integer NOT NULL,
	"tick_upper" integer NOT NULL,
	"liquidity" text DEFAULT '0' NOT NULL,
	"amount0" text DEFAULT '0' NOT NULL,
	"amount1" text DEFAULT '0' NOT NULL,
	"entry_timestamp" timestamp NOT NULL,
	"exit_timestamp" timestamp,
	"entry_gas_cost_usd" double precision DEFAULT 0,
	"is_paper" boolean DEFAULT true NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_hour_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(20) NOT NULL,
	"pool_address" varchar(42) NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"volume_usd" double precision DEFAULT 0 NOT NULL,
	"fee_usd" double precision DEFAULT 0 NOT NULL,
	"tvl_usd" double precision DEFAULT 0 NOT NULL,
	"tick" integer DEFAULT 0 NOT NULL,
	"sqrt_price_x96" text DEFAULT '0' NOT NULL,
	"liquidity" text DEFAULT '0' NOT NULL,
	"tx_count" integer DEFAULT 0 NOT NULL,
	"open_tick" integer,
	"close_tick" integer,
	"high_tick" integer,
	"low_tick" integer
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp NOT NULL,
	"total_value_usd" double precision DEFAULT 0 NOT NULL,
	"total_fees_earned_usd" double precision DEFAULT 0 NOT NULL,
	"total_gas_spent_usd" double precision DEFAULT 0 NOT NULL,
	"net_pnl_usd" double precision DEFAULT 0 NOT NULL,
	"apy_current" double precision DEFAULT 0,
	"apy_7d" double precision DEFAULT 0,
	"apy_30d" double precision DEFAULT 0,
	"high_water_mark_usd" double precision DEFAULT 0 NOT NULL,
	"drawdown_from_peak_pct" double precision DEFAULT 0 NOT NULL,
	"position_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qhvn_benchmark" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" timestamp NOT NULL,
	"cumulative_return_pct" double precision NOT NULL,
	"daily_return_pct" double precision NOT NULL,
	"apy_trailing_30d" double precision
);
--> statement-breakpoint
CREATE TABLE "rebalance_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"position_id" text NOT NULL,
	"chain" varchar(20) NOT NULL,
	"pool_address" varchar(42) NOT NULL,
	"old_tick_lower" integer NOT NULL,
	"old_tick_upper" integer NOT NULL,
	"new_tick_lower" integer NOT NULL,
	"new_tick_upper" integer NOT NULL,
	"gas_cost_usd" double precision DEFAULT 0 NOT NULL,
	"fees_collected_usd" double precision DEFAULT 0 NOT NULL,
	"reason" text,
	"model_prediction" jsonb,
	"timestamp" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stablecoin_peg_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"price" double precision NOT NULL,
	"curve_pool_ratio" double precision,
	"bridge_outflow_1h" double precision,
	"bridge_outflow_24h" double precision,
	"deviation_pct" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swap_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain" varchar(20) NOT NULL,
	"pool_address" varchar(42) NOT NULL,
	"block_number" bigint NOT NULL,
	"tx_hash" varchar(66) NOT NULL,
	"timestamp" timestamp NOT NULL,
	"amount0" text NOT NULL,
	"amount1" text NOT NULL,
	"sqrt_price_x96" text NOT NULL,
	"tick" integer NOT NULL,
	"amount_usd" double precision,
	"fee_usd" double precision
);
--> statement-breakpoint
CREATE INDEX "cex_pair_time_idx" ON "cex_volume_snapshots" USING btree ("pair","exchange","timestamp");--> statement-breakpoint
CREATE INDEX "feature_pool_time_idx" ON "feature_store" USING btree ("pool_address","chain","timestamp");--> statement-breakpoint
CREATE INDEX "pos_chain_status_idx" ON "lp_positions" USING btree ("chain","status");--> statement-breakpoint
CREATE INDEX "phd_pool_time_idx" ON "pool_hour_data" USING btree ("chain","pool_address","hour_timestamp");--> statement-breakpoint
CREATE INDEX "peg_symbol_time_idx" ON "stablecoin_peg_snapshots" USING btree ("symbol","timestamp");--> statement-breakpoint
CREATE INDEX "swap_pool_time_idx" ON "swap_events" USING btree ("chain","pool_address","timestamp");--> statement-breakpoint
CREATE INDEX "swap_hash_idx" ON "swap_events" USING btree ("tx_hash");