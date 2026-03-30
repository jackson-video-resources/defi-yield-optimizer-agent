# One-Shot Setup Prompt

Copy everything below this line and paste it into Claude Code in a fresh empty folder.

---

```
You are going to build a complete AI-driven DeFi liquidity provisioning engine for me from scratch. This system earns passive yield by providing concentrated liquidity in stablecoin pools on Uniswap V3 across Arbitrum, Base, and Optimism. It uses AI models to decide when (and whether) to rebalance positions, minimising gas costs and maximising fee income.

The entire system should end up running 24/7 on Railway with Telegram alerts. I want to start in paper trading mode so no real funds are at risk.

## What you're building

A TypeScript monorepo (npm workspaces) with these services:

1. **data-service** (port 4001) — Scans Uniswap V3 stablecoin pools, backfills 6 months of hourly pool data from The Graph, monitors stablecoin peg deviations every 5 minutes
2. **ml-inference** (port 4002) — Loads ONNX models and serves predictions for volume, volatility, and depeg risk
3. **execution-engine** (port 4003) — Main strategy loop (60s tick): opens/manages/closes LP positions, handles paper trading simulation, compounds fees
4. **risk-service** (port 4004) — Kill switch (triggers on drawdown or depeg), daily gas budget cap, Telegram alerts
5. **dashboard** (port 4000) — React 19 + Vite + Tailwind real-time dashboard showing P&L, APY, positions, and AI decisions

Plus a Python ML training directory (offline only — not deployed) that trains LightGBM, GARCH, and Isolation Forest models and exports them to ONNX.

## Step-by-step instructions

### Step 1: Generate a wallet

Create a new BIP-39 mnemonic (12 words) and derive addresses for Arbitrum, Base, and Optimism. Display:
- The 12-word seed phrase (tell me to write this down and keep it safe)
- The wallet address for each chain (all the same address for EVM chains)
- Encrypt the mnemonic with AES-256-GCM using the ENCRYPTION_KEY I'll set in .env

### Step 2: Scaffold the monorepo

Create this structure:
```
defi-lp-engine/
├── package.json                 (npm workspaces)
├── tsconfig.base.json
├── ecosystem.config.cjs         (PM2 — all 5 services)
├── drizzle.config.ts
├── railway.json
├── nixpacks.toml
├── .env.example
├── .gitignore
├── CLAUDE.md
├── packages/
│   ├── shared/                  (types, ABIs, tick math, constants)
│   ├── data-service/
│   ├── ml-inference/
│   ├── execution-engine/
│   ├── risk-service/
│   └── dashboard/
│       ├── client/              (React + Vite)
│       └── server/
├── ml-training/
│   ├── requirements.txt
│   ├── train/
│   └── backtest/
├── models/                      (ONNX + JSON artifacts — create placeholders)
└── config/
    ├── pools.yaml
    ├── risk_params.yaml
    └── strategy.yaml
```

### Step 3: Build packages/shared

Create:
- `types.ts` — Chain, PoolConfig, PositionState, PredictionResult, PortfolioSnapshot interfaces
- `constants.ts` — TARGET_POOLS array with USDC/USDT 0.01% pool addresses on Arbitrum (0x3416cF6C708Da44DB2624D63ea0AAef7113527C6), Base (0xd0b53D9277642d899DF5C87A3966A349A798F224), and Optimism (0x2ab22ac86b25BD448A4D9dC41Acc17d54e52bAf7). MONITORED_STABLECOINS = ['USDC', 'USDT', 'DAI', 'FRAX']. NonfungiblePositionManager address: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88 (same on all L2s)
- `tick-math.ts` — tickToPrice(), priceToTick(), isInRange()
- `liquidity-math.ts` — getLiquidityForAmounts(), getAmountsForLiquidity()
- `abis/` — NonfungiblePositionManager ABI, UniswapV3Pool ABI (just the methods we need: slot0, liquidity, token0, token1, fee)

### Step 4: Build the database schema

Using Drizzle ORM with PostgreSQL. Create `packages/data-service/src/db/schema.ts` with these tables:
- `pool_hour_data` — chain, pool_address, hour_timestamp, volume_usd, fee_usd, tvl_usd, tick, sqrt_price, tx_count, liquidity
- `swap_events` — chain, pool_address, block_number, tx_hash, timestamp, amount0, amount1, sqrt_price_x96, tick
- `stablecoin_peg_snapshots` — symbol, timestamp, price, deviation_pct
- `feature_store` — pool_address, chain, timestamp, features (JSONB)
- `lp_positions` — chain, pool_address, token_id, tick_lower, tick_upper, liquidity, amount0 (text, used for feesAccrued), amount1 (text, used for capitalUsd), is_paper (boolean), status (text: active/closed), opened_at, closed_at, exit_timestamp
- `rebalance_events` — position_id, old_tick_lower, old_tick_upper, new_tick_lower, new_tick_upper, gas_cost_usd, fees_collected_usd, reason, timestamp
- `portfolio_snapshots` — timestamp, total_value_usd, total_fees_earned_usd, total_gas_spent_usd, net_pnl_usd, apy_current, apy_7d, apy_30d, high_water_mark_usd, drawdown_from_peak_pct, position_count
- `ai_decisions` — decision_type, chain, pool_address, reasoning, model_inputs (JSONB), model_outputs (JSONB), outcome_usd, timestamp
- `qhvn_benchmark` — date (unique), cumulative_return_pct, daily_return_pct
- `depeg_alerts` — symbol, timestamp, price, deviation_pct, action_taken

Generate Drizzle migrations.

### Step 5: Build data-service

`packages/data-service/src/`:
- `index.ts` — Express app, cron jobs (hourly feature update, 5-min peg check), auto-backfill on startup if <1000 rows
- `scanner/subgraph-client.ts` — Query The Graph Uniswap V3 subgraphs for poolHourData. Subgraph URLs: Arbitrum: `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aoo`, Base: `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/GqzP4Xaehti8KSfExGKde6SsTMpEzpt2h5bfH4a4AGBM`, Optimism: `https://gateway.thegraph.com/api/${GRAPH_API_KEY}/subgraphs/id/Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj`
- `ingestion/historical-loader.ts` — Backfill N months of poolHourData, batch upsert to DB
- `scanner/defillama-client.ts` — Fetch stablecoin prices from `https://stablecoins.llama.fi/stablecoins`
- `features/feature-builder.ts` — Compute 14 features per pool per hour: hour/day cyclical sin/cos encodings, volume lags (1h/4h/24h/7d), rolling mean 24h, realized volatility 4h, pool TVL log, volume/TVL ratio
- `db/index.ts` — Drizzle + postgres.js client (detect railway.net/rlwy.net in URL → enable SSL with rejectUnauthorized: false)

### Step 6: Build ml-inference

`packages/ml-inference/src/`:
- `index.ts` — Express app with endpoints: POST /predict/volume, POST /predict/volatility, POST /predict/depeg, POST /allocate-capital
- `volume-predictor.ts` — Load volume_lgb_arbitrum.onnx etc from models/, run inference. If model doesn't exist, return mock prediction (log(volume) = mean of recent data)
- `volatility-forecaster.ts` — GARCH(1,1) recursion from garch_params.json. If no params, use EWMA with 24h halflife. Returns sigma (annualised %)
- `depeg-detector.ts` — Load depeg_iforest.onnx. If no model, return {depegProb: 0.05} mock
- `capital-allocator.ts` — Given predicted yields per pool, compute optimal weights. Simple version: weight proportional to predicted_volume * fee_tier / tvl
- `onnx-runtime.ts` — Wrapper for onnxruntime-node with graceful fallback if model file missing

### Step 7: Build execution-engine

`packages/execution-engine/src/`:
- `position/paper-position.ts` — In-memory paper positions Map, fee accrual simulation (every tick: feesAccrued += volume * feeTier * (capital/tvl) * inRangeFactor), DB persistence (loadPositionsFromDB on startup, savePositionToDB on updates, close with closePositionInDB)
- `position/range-calculator.ts` — Given volatility sigma, compute tick range: halfRange = max(3, ceil(sigma * 10000 * 2)), clamped 3-50 ticks
- `position/rebalancer.ts` — Cost/benefit: expectedFeeIncome4h = volume4h * feeTier * (capital/tvl), gasCostUsd from config. Rebalance only if expectedFeeIncome4h * gasPaybackHours > gasCostUsd AND position has been out of range > 30 min
- `strategy/strategy-engine.ts` — Main 60s loop: fetch pool data → run ML predictions → evaluate positions → rebalance if warranted → snapshot portfolio
- `strategy/pool-scorer.ts` — Score = predictedVolume * feeTier / tvl. Pick highest scoring pool per chain
- `paper/paper-engine.ts` — Simulate full position lifecycle against live pool data
- `db/index.ts` — Same SSL-aware pattern as data-service
- `index.ts` — Express app (health, positions, portfolio, AI decisions endpoints), starts strategy loop, loads positions from DB on startup

### Step 8: Build risk-service

`packages/risk-service/src/`:
- `kill-switch.ts` — File-based kill switch at project_root/.kill-switch. evaluate() checks: drawdownPct > 5%, gasSpentToday > gasBudgetUsd, depegDetected. isKillSwitchActive() uses existsSync. resetKillSwitch() uses unlinkSync
- `drawdown-monitor.ts` — High-water mark tracking. initDrawdown sets initialized=false. updateDrawdown: first call sets HWM. Skip update if totalValueUsd < 1 (positions just closed — prevents false kill switch)
- `depeg-sentinel.ts` — Fetch stablecoin prices from DeFiLlama every 5 min. action: 'exit' if deviation > 5%, 'widen' if > 0.5%, 'none' otherwise
- `alerts.ts` — Telegram bot using fetch. sendAlert(message, level) where level is 'info'|'warning'|'critical'
- `circuit-breaker.ts` — emergencyExit(): POST to execution-engine /positions/close-all, then write kill switch file
- `index.ts` — Express app, 5-min depeg check loop, 60s portfolio check loop (fetches from execution-engine), evaluates kill switch conditions

### Step 9: Build dashboard

`packages/dashboard/`:
- `server/index.ts` — Express, serves built React app from dist/, proxies /api/* to execution-engine and risk-service
- `client/` — React 19 + Vite + Tailwind
  - `src/pages/Overview.tsx` — Stats bar (APY, Net P&L, Fees, Gas, Drawdown, vs Benchmark), cumulative return chart (AI vs QHVN benchmark line), backtest callout card
  - `src/pages/Positions.tsx` — Table of active LP positions with chain, pool, range, fees accrued, status
  - `src/pages/AIDecisions.tsx` — Scrolling feed of recent AI decisions from ai_decisions table
  - `src/pages/RiskPanel.tsx` — Kill switch status, depeg gauge per stablecoin, gas budget progress bar
  - `src/lib/api.ts` — fetchJSON helper, TypeScript interfaces matching DB schema
  - `src/hooks/usePolling.ts` — Generic polling hook
  - `vite.config.ts` — Use absolute paths via import.meta.url for content/outDir, proxy /api to port 4000 server

### Step 10: ML training stubs

`ml-training/`:
- `requirements.txt` — lightgbm, arch, scikit-learn, skl2onnx, onnxmltools, psycopg2-binary, pandas, numpy
- `train/train_volume.py` — LightGBM on pool_hour_data features → export ONNX to models/volume_lgb_{chain}.onnx
- `train/fit_garch.py` — GARCH(1,1) on tick returns → save models/garch_params.json
- `train/train_depeg.py` — Isolation Forest on peg deviation features → models/depeg_iforest.onnx
- `train/tune_rebalance.py` — Grid search on thresholds → models/rebalance_thresholds.json
- `backtest/backtest_engine.py` — Full strategy replay on historical data vs QHVN fixed-4h benchmark

### Step 11: Railway deployment files

- `railway.json` — NIXPACKS builder, ON_FAILURE restart policy, no startCommand (use NIXPACKS_START_CMD env var per service)
- `nixpacks.toml` — nodejs_20, `npm install --ignore-scripts`, no start command
- `ecosystem.config.cjs` — PM2 config for local dev with all 5 services

### Step 12: Environment and config

Create `.env.example` with all required variables. Create `config/pools.yaml`, `config/risk_params.yaml`, `config/strategy.yaml`.

Create `CLAUDE.md` with:
- Full autonomy granted (read/write/delete/bash/commit/push)
- Never ask for confirmation
- Service architecture overview
- Key design rules (paper trading default, stablecoin-only pools, always check rebalance cost/benefit)

## After building

Once the code is complete:
1. Show me the wallet address to fund
2. Run `npm run db:migrate` to create the database
3. Run `npm run dev` to start all services
4. Open http://localhost:4000 for the dashboard
5. Confirm paper trading is active with `curl localhost:4003/health`

Show me the Telegram setup instructions and then ask if I'm ready to deploy to Railway for 24/7 operation.

## Important notes

- Always use `node --import tsx/esm` (not `--loader`) for Node 20+
- All DB connections: detect rlwy.net/railway.internal in URL → use `ssl: { rejectUnauthorized: false }`
- Paper positions persist to DB (loadPositionsFromDB on startup, save on every change)
- Kill switch skip condition: if totalValueUsd < 1, skip drawdown evaluation (positions just closed)
- The dashboard overview chart baseline = first valid snapshot value (not hardcoded $10K)
- GRAPH_API_KEY goes in The Graph subgraph URLs, not as a header
```
