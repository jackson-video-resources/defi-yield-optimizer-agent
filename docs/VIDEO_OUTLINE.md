# Video Outline — DeFi Yield Optimizer Agent Masterclass

**Title options:**
- "I Built a System That Earns 54% APY With Zero Drawdown — And I'm Giving It Away For Free"
- "How I Reverse-Engineered a Hedge Fund's DeFi Strategy and Outperformed It With AI"
- "54% APY, 0% Drawdown, $0 Gas. The Open Source DeFi Yield Machine."

**Format:** Single mega masterclass, ~45-60 min
**Thumbnail:** Side-by-side: hedge fund logo (blurred/generic) with "-41.76% APY" vs your dashboard showing "+54.7% APY"

---

## SECTION 1 — THE HOOK (0:00–5:00)

**Goal:** Make them understand immediately why this is different from every other DeFi yield video.

- Open on the dashboard: live APY number, 0% drawdown, $0 gas, Telegram notification pinging
- "This is running right now. 24/7. On a $5/month server. Earning 54% APY with literally zero drawdown."
- "There is a professional hedge fund that runs this exact type of strategy. Fixed rules, rebalancing every 4 hours. They get 18.57% APY. I beat them by 43 percentage points. And today I'm going to show you exactly how — and give you the whole thing for free."
- Show the backtest numbers briefly (the comparison table)
- Quick architecture preview — 5 services, all talking to each other, Claude Code built the entire thing

---

## SECTION 2 — THE CONCEPT (5:00–18:00)

**Goal:** Explain *why* this works before showing *how* to build it. People who understand the strategy will follow the build with more intent.

### 2.1 — What is concentrated liquidity? (5:00–9:00)
- Uniswap V3 vs V2: the key difference
- You pick a price range. Swaps within your range generate fees. Outside your range: nothing.
- Analogy: you're a market maker on a narrow spread. The tighter the range, the more fees per dollar of capital — but the more often you go out of range.
- Quick visual: show a pool tick chart, show where liquidity sits

### 2.2 — Why stablecoins are the key insight (9:00–12:00)
- USDC/USDT never goes to $0.80 or $1.20. It trades in a band of $0.9990 to $1.0010.
- That means you can set an incredibly tight range and almost never go out of range.
- Impermanent loss is essentially zero — both assets are worth $1.
- You are a fee-collecting machine with no directional risk.
- The only enemy is gas. Every rebalance costs money.

### 2.3 — Why fixed rebalancing kills yield (12:00–15:00)
- The hedge fund benchmark: rebalances every 4 hours regardless of whether it's needed
- 30 days = 348 rebalances = $696 in gas on Arbitrum/Base/Optimism
- Their gross yield was fine. But net of gas: -41.76% APY.
- The math: show actual numbers. $10K × 42% = $4,200 lost per year just to gas on a $10K position.
- "They're basically paying to stay in a race they're already winning."

### 2.4 — The AI edge (15:00–18:00)
- The question: when should you actually rebalance?
- Answer: only when the expected fee income over the gas payback period exceeds the gas cost
- Simple rule: `if (expectedFees4h × hoursToPayback) < gasCost → don't rebalance`
- But to know expected fees, you need to predict volume. That's the LightGBM model.
- To know how wide the range should be, you need to predict volatility. That's GARCH.
- To avoid catastrophic loss, you need to detect depeg early. That's Isolation Forest.
- Combined: a system that earns fees efficiently and exits before anything goes wrong.

---

## SECTION 3 — PREREQUISITES (18:00–23:00)

**Goal:** Get everyone set up before the build starts. Keep this punchy — it's the boring bit.

### What you need
1. **Claude Code** — install it: `npm install -g @anthropic-ai/claude-code` → `claude login`
   - Tip: use Wispr Flow to talk to it instead of typing (show briefly)
2. **Node.js 20+** — `node --version`
3. **PostgreSQL** — `brew install postgresql@16 && brew services start postgresql@16 && createdb defi_lp_engine`
4. **Railway account** — railway.app, free to sign up
5. **The Graph API key** — thegraph.com/studio → API Keys → free tier
6. **Alchemy or Infura** — free tier RPC endpoints (or use the public ones to start)
7. **Telegram bot** — @BotFather → /newbot → copy your token and chat ID

Show the `.env.example` file briefly. Explain each variable takes 2 minutes to fill in.

**Cost check:** "Total: about $25/month when running on Railway. Paper trading mode: completely free."

---

## SECTION 4 — THE BUILD (23:00–52:00)

**Goal:** Walk through building the entire system with Claude Code. Show the AI doing the heavy lifting — this is the "wow" moment for viewers.

*Note: This section can be sped up 2-3x in editing for repetitive parts. Show key moments in real time.*

### 4.1 — Starting fresh with Claude Code (23:00–25:00)
```bash
mkdir my-yield-agent && cd my-yield-agent
claude
```
- Show Claude Code interface
- Mention Wispr Flow for voice input
- "I'm going to paste in a single prompt that tells Claude Code exactly what to build. It will do everything."
- Paste SETUP.md prompt
- Watch Claude Code start scaffolding

### 4.2 — The monorepo scaffold (25:00–28:00)
- Show the directory structure appearing
- Explain workspaces briefly: "5 packages, all sharing types and DB schema"
- Highlight packages/shared — the foundation everything else imports

### 4.3 — The database schema (28:00–30:00)
- Show the Drizzle schema being created
- Walk through key tables: pool_hour_data, lp_positions, portfolio_snapshots, qhvn_benchmark
- "Everything the AI needs lives in PostgreSQL. This is the single source of truth."

### 4.4 — The data pipeline (30:00–34:00)
- Show data-service being built
- Key moment: the subgraph client — explain The Graph in 30 seconds
- Show historical-loader: "It's going to pull 6 months of hourly pool data for every target pool. That's what trains the models."
- Show the peg monitor: "Every 5 minutes it checks if USDC, USDT, DAI, FRAX are still $1."

### 4.5 — The execution engine (34:00–40:00)
- Most important service — where the money logic lives
- paper-position.ts: "Virtual positions. Exact same logic as real, just no blockchain transactions."
- range-calculator.ts: "This is where GARCH feeds in. Higher volatility = wider range."
- rebalancer.ts: "The cost/benefit check. This is the heart of why we beat the benchmark."
- strategy-engine.ts: "60-second loop. Every minute it wakes up, checks everything, makes a decision."

### 4.6 — The risk service (40:00–43:00)
- kill-switch.ts: "One file on disk. If it exists, the engine stops. Simple."
- drawdown-monitor.ts: "High-water mark tracking. If we drop 5% from peak, everything closes."
- depeg-sentinel.ts: "DeFiLlama price check. If USDC loses its peg, we're out before everyone else."
- alerts.ts: "Telegram message. You get a ping for everything important."
- Show a Telegram notification example

### 4.7 — The dashboard (43:00–47:00)
- Show it loading in the browser at localhost:4000
- Walk through the Overview page: APY, P&L, the comparison chart
- "That red dashed line is the hedge fund benchmark. That's what we're beating."
- Positions page: show a live paper position
- Risk panel: kill switch button, depeg gauges

### 4.8 — Running the first backtest (47:00–50:00)
- Switch to ml-training/
- `python3 backtest/backtest_engine.py --chain arbitrum --capital 10000`
- Watch the results print
- Show the comparison: AI vs hedge fund benchmark
- "This is 30 days of real historical data. The AI made 0 rebalances. The benchmark made 116."

### 4.9 — Paper trading is live (50:00–52:00)
- `npm run dev` (or show Railway already running)
- Show positions opening in the dashboard
- Show the first Telegram notification: "Opened position on Arbitrum: USDC/USDT, ticks [-5, +15]"
- "It's running. It's paper trading. It will collect virtual fees every minute until you decide to go live."

---

## SECTION 5 — RAILWAY DEPLOYMENT (52:00–57:00)

**Goal:** Show how to make it run 24/7 without your laptop.

```bash
npm install -g @railway/cli
railway login
railway init
railway add --database postgres
```

- Set environment variables in Railway dashboard (walk through each one)
- `railway up`
- Show the deployment succeeding
- Show both services (data-service + execution-engine) running in Railway dashboard
- Check logs: "Backfilling historical data... 13,029 rows loaded"
- Show execution-engine opening positions on Railway
- "Your laptop can be off. This is running on Railway's servers."
- Monthly cost: ~$5-10

---

## SECTION 6 — GOING LIVE (57:00–59:00)

**Brief section — this is the one thing viewers do themselves.**

1. Set `PAPER_TRADING=false` in Railway env vars
2. Fund the wallet address Claude Code generated for you (show the address)
3. "Send USDC to this address on Arbitrum, Base, and Optimism. That's it. The system takes over."
4. How much to start with: "Start small. $100-$500. Watch it for a week. Scale up if you're comfortable."
5. The only thing you'll see after that: Telegram notifications and the dashboard ticking up.

**Important disclaimer:** "This is experimental software. DeFi has smart contract risk. Only deploy what you can afford to lose. Paper trade first — the system is designed so you never have to skip that step."

---

## SECTION 7 — THE EASY WAY (59:00–61:00)

**Goal:** Close with the one-shot prompt as the "wow" moment for viewers who just want it running fast.

- "Everything I just showed you over the last hour? This single prompt does it automatically."
- Show SETUP.md on GitHub
- "You open Claude Code. You paste this. You walk away. Come back in 20 minutes and it's built."
- Show it in action (time-lapsed)
- "The only thing you do: send funds to the wallet address it gives you."
- CTA: Star the repo, leave a comment with your APY once it's running

---

## OUTRO (61:00–63:00)

- "The strategy is open source. The code is free. The tutorial is free. All I ask is you star the repo and let me know how it goes."
- GitHub link
- "If you want me to build something like this for you — whether it's a different DeFi strategy, a trading bot, or something else entirely — the link in the description."
- Subscribe CTA: "Next video: I'm going to train the ML models on live data and see if we can push the APY even higher."

---

## B-Roll / Visual Notes

- Dashboard running: record a continuous screen capture — use this throughout
- Telegram notifications: record a few real ones pinging on phone
- The backtest numbers printing: record in real time (it takes ~10s, good tension)
- Railway build logs: good visual, show the "Successfully Built" green text
- The comparison chart in the dashboard: hero visual, use in thumbnail
- Wispr Flow: show briefly speaking to Claude Code rather than typing

## Chapters for YouTube Description

```
0:00 - What this system does (live demo)
5:00 - The concept: concentrated liquidity explained
9:00 - Why stablecoins = zero drawdown
12:00 - Why the hedge fund loses to gas costs
15:00 - How AI fixes the rebalancing problem
18:00 - Prerequisites & setup (5 minutes)
23:00 - Building with Claude Code
28:00 - The database schema
30:00 - Data pipeline & historical backfill
34:00 - The execution engine (the core logic)
40:00 - Risk management & kill switch
43:00 - The real-time dashboard
47:00 - Running the 30-day backtest
50:00 - Paper trading goes live
52:00 - Deploying to Railway (24/7)
57:00 - Going live with real capital
59:00 - The one-shot prompt (build it in 20 min)
```
