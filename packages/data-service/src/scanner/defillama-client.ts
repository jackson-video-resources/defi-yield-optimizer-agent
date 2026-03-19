/**
 * DeFiLlama API client — free, no API key required.
 * Used for stablecoin peg history and cross-protocol yield comparison.
 */

const LLAMA_BASE = "https://stablecoins.llama.fi";
const YIELDS_BASE = "https://yields.llama.fi";

export interface StablecoinPegPoint {
  date: Date;
  price: number;
  deviationPct: number;
}

export interface YieldPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number;
  apyBase: number;
  pool: string;
  stablecoin: boolean;
}

/**
 * Fetch historical peg data for a stablecoin.
 * Returns daily price history with deviation from $1.00.
 */
export async function fetchStablecoinPegHistory(
  symbol: string,
): Promise<StablecoinPegPoint[]> {
  // DeFiLlama stablecoin ID mapping (major ones)
  const idMap: Record<string, string> = {
    USDC: "1",
    USDT: "2",
    DAI: "5",
    FRAX: "6",
    BUSD: "4",
    USDbC: "1", // Same as USDC
  };

  const id = idMap[symbol.toUpperCase()];
  if (!id) {
    console.warn(`No DeFiLlama ID for ${symbol}, skipping peg history`);
    return [];
  }

  const res = await fetch(`${LLAMA_BASE}/stablecoin/${id}`);
  if (!res.ok) throw new Error(`DeFiLlama peg history failed: ${res.status}`);

  const data = (await res.json()) as {
    pegMechanism: string;
    priceData?: { prices?: { date: number; price: Record<string, number> }[] };
  };

  const prices = data.priceData?.prices || [];
  return prices
    .filter((p) => p.price?.usd !== undefined)
    .map((p) => ({
      date: new Date(p.date * 1000),
      price: p.price.usd,
      deviationPct: Math.abs(p.price.usd - 1.0) * 100,
    }));
}

/**
 * Fetch current yields for stablecoin pools across protocols.
 * Useful for finding cross-protocol opportunities.
 */
export async function fetchStablecoinYields(): Promise<YieldPool[]> {
  const res = await fetch(`${YIELDS_BASE}/pools`);
  if (!res.ok) throw new Error(`DeFiLlama yields failed: ${res.status}`);

  const data = (await res.json()) as { data: YieldPool[] };

  return data.data.filter(
    (p) =>
      p.stablecoin &&
      ["uniswap-v3", "aerodrome", "velodrome"].includes(
        p.project.toLowerCase(),
      ) &&
      ["Arbitrum", "Base", "Optimism"].includes(p.chain) &&
      p.tvlUsd > 100_000, // Minimum TVL
  );
}

/**
 * Fetch current USDC price from DeFiLlama to detect live depeg.
 */
export async function fetchStablecoinCurrentPrices(): Promise<
  Record<string, number>
> {
  const res = await fetch(`${LLAMA_BASE}/stablecoins?includePrices=true`);
  if (!res.ok) throw new Error(`DeFiLlama stablecoins failed: ${res.status}`);

  const data = (await res.json()) as {
    peggedAssets: { symbol: string; price: number }[];
  };

  const prices: Record<string, number> = {};
  for (const asset of data.peggedAssets || []) {
    if (asset.price) {
      prices[asset.symbol.toUpperCase()] = asset.price;
    }
  }
  return prices;
}
