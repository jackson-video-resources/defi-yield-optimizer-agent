/**
 * Uniswap V3 tick mathematics — pure TypeScript port of the Solidity TickMath library.
 * Tick 0 = price 1.0 for same-decimal pairs (e.g. USDC/USDT).
 * Price = 1.0001^tick
 */

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

// Q96 fixed point
const Q96 = 2n ** 96n;

/**
 * Get the square root ratio at a given tick as a Q64.96 fixed-point number.
 * This is the core Uniswap V3 formula.
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  const absTick = Math.abs(tick);
  if (absTick > MAX_TICK) throw new Error(`Tick ${tick} out of range`);

  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;

  if ((absTick & 0x2) !== 0)
    ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n;
  if ((absTick & 0x4) !== 0)
    ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n;
  if ((absTick & 0x8) !== 0)
    ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n;
  if ((absTick & 0x10) !== 0)
    ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n;
  if ((absTick & 0x20) !== 0)
    ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n;
  if ((absTick & 0x40) !== 0)
    ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n;
  if ((absTick & 0x80) !== 0)
    ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053n) >> 128n;
  if ((absTick & 0x100) !== 0)
    ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n;
  if ((absTick & 0x200) !== 0)
    ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54n) >> 128n;
  if ((absTick & 0x400) !== 0)
    ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n;
  if ((absTick & 0x800) !== 0)
    ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n;
  if ((absTick & 0x1000) !== 0)
    ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n;
  if ((absTick & 0x2000) !== 0)
    ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n;
  if ((absTick & 0x4000) !== 0)
    ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n;
  if ((absTick & 0x8000) !== 0)
    ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n;
  if ((absTick & 0x10000) !== 0)
    ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n;
  if ((absTick & 0x20000) !== 0)
    ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n;
  if ((absTick & 0x40000) !== 0)
    ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n;
  if ((absTick & 0x80000) !== 0)
    ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n;

  if (tick > 0)
    ratio =
      BigInt(
        "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ) / ratio;

  // Convert from Q128 to Q96, rounding up
  const sqrtPriceX96 = (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
  return sqrtPriceX96;
}

/**
 * Get the tick at a given sqrt ratio.
 */
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (
    sqrtPriceX96 < getSqrtRatioAtTick(MIN_TICK) ||
    sqrtPriceX96 > getSqrtRatioAtTick(MAX_TICK)
  ) {
    throw new Error("sqrtPriceX96 out of valid range");
  }

  // Binary search for the tick
  let low = MIN_TICK;
  let high = MAX_TICK;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const sqrtAtMid = getSqrtRatioAtTick(mid);
    if (sqrtAtMid <= sqrtPriceX96) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

/**
 * Convert tick to price (token1 per token0).
 */
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

/**
 * Convert price to the nearest valid tick for a given tick spacing.
 */
export function priceToTick(price: number, tickSpacing: number = 1): number {
  const tick = Math.round(Math.log(price) / Math.log(1.0001));
  return Math.round(tick / tickSpacing) * tickSpacing;
}

/**
 * Round a tick down to the nearest valid tick for a given tick spacing.
 */
export function roundTickDown(tick: number, tickSpacing: number): number {
  return Math.floor(tick / tickSpacing) * tickSpacing;
}

/**
 * Round a tick up to the nearest valid tick for a given tick spacing.
 */
export function roundTickUp(tick: number, tickSpacing: number): number {
  return Math.ceil(tick / tickSpacing) * tickSpacing;
}

/**
 * Compute a symmetric tick range centered on the current tick.
 * Returns [tickLower, tickUpper] rounded to tickSpacing.
 */
export function computeRange(
  currentTick: number,
  halfWidthTicks: number,
  tickSpacing: number,
): [number, number] {
  const tickLower = roundTickDown(currentTick - halfWidthTicks, tickSpacing);
  const tickUpper = roundTickUp(currentTick + halfWidthTicks, tickSpacing);
  return [tickLower, tickUpper];
}

/**
 * Check if a current tick is within a position's range.
 */
export function isInRange(
  currentTick: number,
  tickLower: number,
  tickUpper: number,
): boolean {
  return currentTick >= tickLower && currentTick < tickUpper;
}

/**
 * How far from center is the current price? Returns 0-1 where 1 = at edge.
 */
export function rangeUtilization(
  currentTick: number,
  tickLower: number,
  tickUpper: number,
): number {
  const center = (tickLower + tickUpper) / 2;
  const halfWidth = (tickUpper - tickLower) / 2;
  return Math.abs(currentTick - center) / halfWidth;
}
