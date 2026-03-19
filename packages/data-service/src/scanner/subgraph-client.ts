/**
 * The Graph subgraph client for Uniswap V3 pool data.
 * Pulls historical poolHourData and live pool state.
 */

import type { Chain } from "@lp-engine/shared";
import { SUBGRAPH_URLS } from "@lp-engine/shared";

const GRAPHQL_QUERY_POOL_HOUR_DATA = `
  query PoolHourData($pool: String!, $startTime: Int!, $skip: Int!) {
    poolHourDatas(
      where: { pool: $pool, periodStartUnix_gt: $startTime }
      orderBy: periodStartUnix
      orderDirection: asc
      first: 1000
      skip: $skip
    ) {
      periodStartUnix
      volumeUSD
      feesUSD
      tvlUSD
      tick
      sqrtPrice
      liquidity
      txCount
      open
      close
      high
      low
    }
  }
`;

const GRAPHQL_QUERY_POOL_STATE = `
  query PoolState($pool: String!) {
    pool(id: $pool) {
      id
      feeTier
      liquidity
      sqrtPrice
      tick
      totalValueLockedUSD
      volumeUSD
      feesUSD
      txCount
      token0 { id symbol decimals }
      token1 { id symbol decimals }
      poolHourData(first: 24, orderBy: periodStartUnix, orderDirection: desc) {
        periodStartUnix
        volumeUSD
        feesUSD
        tvlUSD
      }
    }
  }
`;

interface PoolHourDataRaw {
  periodStartUnix: string;
  volumeUSD: string;
  feesUSD: string;
  tvlUSD: string;
  tick: string;
  sqrtPrice: string;
  liquidity: string;
  txCount: string;
  open: string;
  close: string;
  high: string;
  low: string;
}

export interface PoolHourDataPoint {
  timestamp: Date;
  volumeUsd: number;
  feeUsd: number;
  tvlUsd: number;
  tick: number;
  sqrtPriceX96: string;
  liquidity: string;
  txCount: number;
  openTick: number;
  closeTick: number;
  highTick: number;
  lowTick: number;
}

export interface PoolStateData {
  address: string;
  feeTier: number;
  liquidity: string;
  sqrtPriceX96: string;
  currentTick: number;
  tvlUsd: number;
  volume24hUsd: number;
  fee24hUsd: number;
  token0Symbol: string;
  token1Symbol: string;
}

async function graphqlQuery<T>(
  chain: Chain,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const url = SUBGRAPH_URLS[chain];
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok)
    throw new Error(`Subgraph request failed: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors)
    throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`);
  if (!json.data) throw new Error("No data returned from subgraph");

  return json.data;
}

/**
 * Fetch historical hourly data for a pool.
 * Paginates through all results starting from startTime.
 */
export async function fetchPoolHourData(
  chain: Chain,
  poolAddress: string,
  startTime: Date,
  endTime: Date = new Date(),
): Promise<PoolHourDataPoint[]> {
  const allData: PoolHourDataPoint[] = [];
  const startTimestamp = Math.floor(startTime.getTime() / 1000);
  let skip = 0;

  while (true) {
    const data = await graphqlQuery<{ poolHourDatas: PoolHourDataRaw[] }>(
      chain,
      GRAPHQL_QUERY_POOL_HOUR_DATA,
      {
        pool: poolAddress.toLowerCase(),
        startTime: startTimestamp,
        skip,
      },
    );

    const batch = data.poolHourDatas;
    if (batch.length === 0) break;

    for (const row of batch) {
      const ts = new Date(parseInt(row.periodStartUnix) * 1000);
      if (ts > endTime) break;

      allData.push({
        timestamp: ts,
        volumeUsd: parseFloat(row.volumeUSD),
        feeUsd: parseFloat(row.feesUSD),
        tvlUsd: parseFloat(row.tvlUSD),
        tick: parseInt(row.tick),
        sqrtPriceX96: row.sqrtPrice,
        liquidity: row.liquidity,
        txCount: parseInt(row.txCount),
        openTick: parseInt(row.open),
        closeTick: parseInt(row.close),
        highTick: parseInt(row.high),
        lowTick: parseInt(row.low),
      });
    }

    if (batch.length < 1000) break;
    skip += 1000;
    // Rate limiting
    await new Promise((r) => setTimeout(r, 200));
  }

  return allData;
}

/**
 * Fetch current state of a pool.
 */
export async function fetchPoolState(
  chain: Chain,
  poolAddress: string,
): Promise<PoolStateData | null> {
  const data = await graphqlQuery<{ pool: Record<string, unknown> | null }>(
    chain,
    GRAPHQL_QUERY_POOL_STATE,
    {
      pool: poolAddress.toLowerCase(),
    },
  );

  if (!data.pool) return null;
  const p = data.pool as Record<string, unknown>;

  const hourData = (p.poolHourData as Record<string, unknown>[]) || [];
  const volume24h = hourData.reduce(
    (sum, h) => sum + parseFloat(h.volumeUSD as string),
    0,
  );
  const fees24h = hourData.reduce(
    (sum, h) => sum + parseFloat(h.feesUSD as string),
    0,
  );

  return {
    address: poolAddress,
    feeTier: parseInt(p.feeTier as string),
    liquidity: p.liquidity as string,
    sqrtPriceX96: p.sqrtPrice as string,
    currentTick: parseInt(p.tick as string),
    tvlUsd: parseFloat(p.totalValueLockedUSD as string),
    volume24hUsd: volume24h,
    fee24hUsd: fees24h,
    token0Symbol: (p.token0 as Record<string, string>).symbol,
    token1Symbol: (p.token1 as Record<string, string>).symbol,
  };
}
