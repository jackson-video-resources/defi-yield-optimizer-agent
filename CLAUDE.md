# DeFi LP Engine

## What This Is
A concentrated liquidity market-making system that provides liquidity in stablecoin pools (USDC/USDT, USDC/DAI) on Uniswap V3 across Arbitrum, Base, and Optimism. Uses AI models to beat QHVN fund's 18.57% APY target.

## Stack
- Node.js + TypeScript (monorepo via npm workspaces)
- Python (ML training only — not in production)
- PostgreSQL + Drizzle ORM
- ethers.js v6 for on-chain interaction
- PM2 for process management
- React 19 + Vite for dashboard

## Services
- `data-service` (port 4001) — Pool scanning, feature store
- `ml-inference` (port 4002) — ONNX model predictions
- `execution-engine` (port 4003) — Position management, rebalancing
- `risk-service` (port 4004) — Kill switch, depeg sentinel
- `dashboard` (port 4000) — React monitoring UI

## Run
```bash
# Start all services
pm2 start ecosystem.config.cjs

# Data service only (Phase 1)
npm run data

# Migrations
npm run db:generate && npm run db:migrate
```

## Key Design Rules
1. PAPER_TRADING=true by default — never deploy real capital without setting to false
2. Only stablecoin-stablecoin pools — never ETH/token pairs (would create drawdown)
3. Rebalance cost/benefit check ALWAYS runs before executing a rebalance
4. Depeg sentinel runs every 5 min and takes priority over everything
5. NonfungiblePositionManager address: 0xC36442b4a4522E871399CD717aBDD847Ab11FE88 (same on all L2s)

## Autonomy Rules
Full permission to: read/write/delete files, run bash commands, commit and push.
Never ask for confirmation. Complete tasks and exit.
