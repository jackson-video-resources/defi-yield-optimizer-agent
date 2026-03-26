import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KILL_SWITCH_FILE = join(__dirname, "../../../.kill-switch"); // project root

export interface KillSwitchState {
  active: boolean;
  reason?: string;
  triggeredAt?: string;
}

export interface KillSwitchCondition {
  name: string;
  check: (metrics: PortfolioMetrics) => boolean;
  reason: string;
}

export interface PortfolioMetrics {
  drawdownPct: number;
  gasSpentToday: number;
  gasBudgetUsd: number;
  depegDetected: boolean;
  consecutiveRebalanceFails: number;
  netPnlUsd: number;
}

const CONDITIONS: KillSwitchCondition[] = [
  {
    name: "drawdown_limit",
    check: (m) => m.drawdownPct > 2.0,
    reason: "Drawdown exceeded 2% limit",
  },
  {
    name: "gas_budget",
    check: (m) => m.gasSpentToday > m.gasBudgetUsd,
    reason: "Daily gas budget exhausted",
  },
  {
    name: "depeg_detected",
    check: (m) => m.depegDetected,
    reason: "Stablecoin depeg detected — emergency exit",
  },
  {
    name: "rebalance_fails",
    check: (m) => m.consecutiveRebalanceFails >= 3,
    reason: "3 consecutive rebalance failures",
  },
];

export function evaluateKillSwitch(metrics: PortfolioMetrics): KillSwitchState {
  // Check if manually activated
  if (existsSync(KILL_SWITCH_FILE)) {
    const content = readFileSync(KILL_SWITCH_FILE, "utf-8").trim();
    return {
      active: true,
      reason: `Manual: ${content}`,
      triggeredAt: new Date().toISOString(),
    };
  }

  for (const cond of CONDITIONS) {
    if (cond.check(metrics)) {
      const state: KillSwitchState = {
        active: true,
        reason: cond.reason,
        triggeredAt: new Date().toISOString(),
      };
      // Write file so other services see it
      writeFileSync(KILL_SWITCH_FILE, cond.reason);
      console.log(`[kill-switch] TRIGGERED: ${cond.reason}`);
      return state;
    }
  }

  return { active: false };
}

export function resetKillSwitch(): void {
  if (existsSync(KILL_SWITCH_FILE)) {
    try {
      unlinkSync(KILL_SWITCH_FILE);
    } catch {}
  }
}

export function isKillSwitchActive(): boolean {
  return existsSync(KILL_SWITCH_FILE);
}
