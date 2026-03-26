import fetch from "node-fetch";

const DEFI_LLAMA_PEG_URL =
  "https://stablecoins.llama.fi/stablecoins?includePrices=true";

export interface PegStatus {
  symbol: string;
  price: number;
  deviationPct: number;
  status: "ok" | "warning" | "danger";
}

export interface DepegCheckResult {
  timestamp: string;
  statuses: PegStatus[];
  maxDeviation: number;
  dangerCount: number;
  action: "none" | "widen" | "exit";
}

const STABLECOINS = ["USDC", "USDT", "DAI", "USDe", "USDbC"];
const WARNING_THRESHOLD = 0.3; // 0.3% deviation
const DANGER_THRESHOLD = 1.0; // 1.0% deviation

// Track consecutive danger signals
let consecutiveDangerCount = 0;

export async function checkPegStatus(): Promise<DepegCheckResult> {
  const statuses: PegStatus[] = [];

  try {
    const res = await fetch(DEFI_LLAMA_PEG_URL, {
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json()) as any;
    const coins = data.peggedAssets || [];

    for (const symbol of STABLECOINS) {
      const coin = coins.find(
        (c: any) =>
          c.symbol?.toUpperCase() === symbol ||
          c.name?.toUpperCase().includes(symbol),
      );

      if (coin?.price) {
        const price = coin.price;
        const deviationPct = Math.abs(price - 1.0) * 100;
        statuses.push({
          symbol,
          price,
          deviationPct,
          status:
            deviationPct > DANGER_THRESHOLD
              ? "danger"
              : deviationPct > WARNING_THRESHOLD
                ? "warning"
                : "ok",
        });
      } else {
        // Not found — assume ok
        statuses.push({ symbol, price: 1.0, deviationPct: 0, status: "ok" });
      }
    }
  } catch (err) {
    console.error("[depeg] Failed to fetch peg data:", err);
    // Return safe defaults on error
    for (const symbol of STABLECOINS) {
      statuses.push({ symbol, price: 1.0, deviationPct: 0, status: "ok" });
    }
  }

  const maxDeviation = Math.max(...statuses.map((s) => s.deviationPct));
  const dangerCount = statuses.filter((s) => s.status === "danger").length;

  // Determine action
  let action: "none" | "widen" | "exit" = "none";
  if (dangerCount > 0) {
    consecutiveDangerCount++;
    if (consecutiveDangerCount >= 3) {
      action = "exit";
    } else {
      action = "widen";
    }
  } else {
    consecutiveDangerCount = 0;
    if (maxDeviation > WARNING_THRESHOLD) {
      action = "widen";
    }
  }

  return {
    timestamp: new Date().toISOString(),
    statuses,
    maxDeviation,
    dangerCount,
    action,
  };
}
