/**
 * Uniswap V3 liquidity math — compute token amounts from liquidity and vice versa.
 * Critical for calculating position values and fee accrual.
 */

import { getSqrtRatioAtTick } from "./tick-math.js";

const Q96 = 2n ** 96n;

/**
 * Compute token amounts for a given liquidity amount within a tick range.
 * Used to understand how much of each token is in a position.
 */
export function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const sqrtPriceLower = getSqrtRatioAtTick(tickLower);
  const sqrtPriceUpper = getSqrtRatioAtTick(tickUpper);

  let amount0 = 0n;
  let amount1 = 0n;

  if (sqrtPriceX96 <= sqrtPriceLower) {
    // All token0
    amount0 = getLiquidityForAmount0(sqrtPriceLower, sqrtPriceUpper, liquidity);
  } else if (sqrtPriceX96 < sqrtPriceUpper) {
    // Mixed
    amount0 = getLiquidityForAmount0(sqrtPriceX96, sqrtPriceUpper, liquidity);
    amount1 = getLiquidityForAmount1(sqrtPriceLower, sqrtPriceX96, liquidity);
  } else {
    // All token1
    amount1 = getLiquidityForAmount1(sqrtPriceLower, sqrtPriceUpper, liquidity);
  }

  return { amount0, amount1 };
}

function getLiquidityForAmount0(
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (liquidity * Q96 * (sqrtB - sqrtA)) / sqrtB / sqrtA;
}

function getLiquidityForAmount1(
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (liquidity * (sqrtB - sqrtA)) / Q96;
}

/**
 * Compute the liquidity for given token amounts in a range.
 * Used to calculate how much liquidity to mint.
 */
export function getLiquidityForAmounts(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const sqrtPriceLower = getSqrtRatioAtTick(tickLower);
  const sqrtPriceUpper = getSqrtRatioAtTick(tickUpper);

  let liquidity: bigint;

  if (sqrtPriceX96 <= sqrtPriceLower) {
    liquidity = getLiquidityFromAmount0(
      sqrtPriceLower,
      sqrtPriceUpper,
      amount0,
    );
  } else if (sqrtPriceX96 < sqrtPriceUpper) {
    const liq0 = getLiquidityFromAmount0(sqrtPriceX96, sqrtPriceUpper, amount0);
    const liq1 = getLiquidityFromAmount1(sqrtPriceLower, sqrtPriceX96, amount1);
    liquidity = liq0 < liq1 ? liq0 : liq1;
  } else {
    liquidity = getLiquidityFromAmount1(
      sqrtPriceLower,
      sqrtPriceUpper,
      amount1,
    );
  }

  return liquidity;
}

function getLiquidityFromAmount0(
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (amount0 * sqrtA * sqrtB) / Q96 / (sqrtB - sqrtA);
}

function getLiquidityFromAmount1(
  sqrtA: bigint,
  sqrtB: bigint,
  amount1: bigint,
): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return (amount1 * Q96) / (sqrtB - sqrtA);
}

/**
 * Estimate annual fee yield for a position.
 * This is the core calculation: how much do we earn as a fraction of TVL?
 *
 * @param poolVolume24hUsd - Total pool volume in last 24h
 * @param feeTier - Pool fee tier (e.g. 100 = 0.01%)
 * @param positionLiquidity - Our position's liquidity
 * @param totalPoolLiquidity - Total active pool liquidity
 */
export function estimateFeeAPY(
  poolVolume24hUsd: number,
  feeTier: number,
  positionLiquidity: bigint,
  totalPoolLiquidity: bigint,
): number {
  if (totalPoolLiquidity === 0n) return 0;

  const ourShare = Number(positionLiquidity) / Number(totalPoolLiquidity);
  const dailyFees = poolVolume24hUsd * (feeTier / 1_000_000) * ourShare;
  const annualFees = dailyFees * 365;

  return annualFees;
}
