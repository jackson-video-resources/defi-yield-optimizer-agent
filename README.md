# DeFi LP Engine — AI-Driven Concentrated Liquidity Market Maker

> **54.7% APY. 0% drawdown. $0 in gas fees. Running 24/7 on autopilot.**
>
> This is the complete open-source system I built to reverse-engineer and outperform a professional hedge fund's DeFi yield strategy — using Claude Code, Uniswap V3, and a handful of AI models. Watch the full build masterclass below, then deploy your own copy in minutes.

[![Watch the Masterclass](https://img.shields.io/badge/YouTube-Watch%20the%20Masterclass-red?style=for-the-badge&logo=youtube)](https://youtube.com/@lewisjackson)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

---

## The Numbers

| Metric | This Strategy | QHVN (Hedge Fund Benchmark) |
|--------|--------------|------------------------------|
| APY | **54.7%** | 18.57% |
| Drawdown | **0%** | 0% |
| Gas spent (30 days) | **$0** | $696 |
| Rebalances (30 days) | **0** | 348 |
| APY advantage | **+43.6 percentage points** | — |

*30-day backtest on Arbitrum/Base/Optimism USDC/USDT pools. Live paper trading results from 10 days running.*

---

## What This Is

Concentrated liquidity market making means you deposit two stablecoins (e.g. USDC + USDT) into a Uniswap V3 pool and earn a cut of every swap that routes through your range. Because both assets are worth ~$1, there's essentially **zero impermanent loss** — you just collect fees.

The problem with doing this manually (or with fixed rules like the hedge fund benchmark) is gas. Every time you "rebalance" to recenter your position, you pay a transaction fee. Rebalance too often and the gas eats your yield entirely.

**This system uses AI to decide when rebalancing is actually worth it.** The answer, most of the time, is: it isn't. Stablecoin pairs barely move. The AI watches the pool, forecasts volatility, and only rebalances when the maths says the fee recovery justifies the gas cost. Otherwise it does nothing — and collects yield.

---

## Architecture

```
5 services, all deployed to Railway, all talking through PostgreSQL

data-service     — Scans Uniswap V3 pools, backfills 6 months of history
ml-inference     — ONNX model predictions (volume, volatility, depeg risk)
execution-engine — Opens/closes LP positions, compounds fees
risk-service     — Kill switch, depeg sentinel, drawdown monitor
dashboard        — Real-time P&L vs benchmark (React + Vite)

ML Training (offline, Python)
└── LightGBM volume predictor → ONNX
└── GARCH(1,1) volatility forecaster → JSON params
└── Isolation Forest depeg detector → ONNX
└── Grid-search rebalance optimizer → JSON thresholds
```

---

## What You'll Need

| Requirement | Cost | Notes |
|-------------|------|-------|
| [Claude Code](https://claude.ai/code) | $20/mo | Does the entire build for you |
| [Railway](https://railway.app) | ~$5/mo | 24/7 cloud hosting |
| PostgreSQL | Free | Provisioned by Railway automatically |
| [Alchemy](https://alchemy.com) or [Infura](https://infura.io) | Free tier | RPC endpoints for Arbitrum/Base/Optimism |
| [The Graph API key](https://thegraph.com/studio/) | Free | Historical pool data |
| Telegram bot | Free | Alerts via @BotFather |
| Capital (optional) | Your choice | Start in paper trading mode — $0 needed to test |

**Total running cost: ~$25/month.** Paper trading mode is completely free.

---

## Quick Setup (One-Shot Claude Code)

The fastest path: copy the prompt from [SETUP.md](SETUP.md), paste it into Claude Code, and let it build and deploy everything for you.

```bash
# 1. Install Claude Code
npm install -g @anthropic-ai/claude-code

# 2. Create a new folder
mkdir my-lp-engine && cd my-lp-engine

# 3. Open Claude Code and paste the prompt from SETUP.md
claude
```

Claude Code will:
- Scaffold the entire monorepo
- Generate encrypted wallets (you just send funds to the address it gives you)
- Set up Railway with all 5 services
- Configure your Telegram alerts
- Start paper trading immediately

**The only thing you do yourself: send USDC to the wallet address it generates.**

---

## Manual Setup

If you want to understand every piece before deploying:

### 1. Clone and install
```bash
git clone https://github.com/jackson-video-resources/defi-lp-engine
cd defi-lp-engine
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL=postgresql://localhost/defi_lp_engine

# Get from Alchemy or Infura (free)
RPC_ARBITRUM=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_KEY
RPC_OPTIMISM=https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY

# Get from thegraph.com/studio → API Keys (free)
GRAPH_API_KEY=your_key_here

# Wallet encryption — generate: openssl rand -hex 32
ENCRYPTION_KEY=your_64_hex_chars

# Telegram — create bot via @BotFather
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# Keep true until you're ready to deploy real capital
PAPER_TRADING=true

# Capital per chain in USD (paper trading uses virtual funds)
CAPITAL_PER_CHAIN=10000
```

### 3. Set up PostgreSQL
```bash
brew install postgresql@16
brew services start postgresql@16
createdb defi_lp_engine
npm run db:migrate
```

### 4. Backfill historical data
```bash
npm run data
# Wait ~5 minutes — loads 6 months of Uniswap V3 pool data
```

### 5. Start everything
```bash
npm run dev
# Starts all 5 services via PM2
```

### 6. Open the dashboard
```
http://localhost:4000
```

---

## Railway Deployment (24/7)

```bash
npm install -g @railway/cli
railway login
railway init
railway add --database postgres
railway up
```

Set environment variables in Railway dashboard, then your strategy runs 24/7 regardless of whether your laptop is on.

Full deployment guide: [docs/railway-deployment.md](docs/railway-deployment.md)

---

## Going Live (Real Capital)

When you're ready to trade with real money:

1. Set `PAPER_TRADING=false` in your `.env`
2. Fund your generated wallets with USDC on Arbitrum, Base, and Optimism
3. The system handles everything from there

Start small. The system is designed to scale — the strategy works the same whether you're deploying $1,000 or $1,000,000.

---

## How the AI Works

**5 models, all running inference in Node.js via ONNX:**

1. **Volume Predictor (LightGBM)** — forecasts 4h pool volume to pre-position capital before fee spikes
2. **Volatility Forecaster (GARCH + EWMA)** — sets tick range width: narrow in calm markets, wide in volatile ones
3. **Rebalance Optimizer** — evaluates whether the gas cost of rebalancing is worth it given current conditions
4. **Capital Allocator** — distributes capital across chains to maximise total fee income
5. **Depeg Sentinel (Isolation Forest)** — detects early signs of a stablecoin losing its peg and exits before catastrophic impermanent loss

The models train in Python (`ml-training/`), export to ONNX, and run entirely in Node.js in production. No Python in the deployed stack.

---

## Safety Features

- **Kill switch** — file-based, triggers on >5% drawdown or depeg detection
- **Gas budget cap** — daily maximum prevents runaway rebalancing costs
- **Paper trading mode** — full simulation before any real funds are touched
- **Stablecoin-only pools** — eliminates directional price risk entirely
- **Sandwich protection** — positions submitted directly to L2 sequencers (no public mempool on Arbitrum/Base/Optimism)

---

## Disclaimer

This is experimental software. DeFi carries smart contract risk, oracle risk, and the risk of stablecoin depeg events. Paper trade first. Never deploy more than you can afford to lose. This is not financial advice.

---

## License

MIT — use it, fork it, build on it.
