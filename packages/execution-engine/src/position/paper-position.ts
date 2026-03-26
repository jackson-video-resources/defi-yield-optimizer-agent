import type { Chain } from "@lp-engine/shared";
import { EXECUTION_POOL_ADDRESSES } from "@lp-engine/shared";
import { db } from "../db/index.js";
import { lpPositions } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

export interface PaperPosition {
  id: string;
  chain: Chain;
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  capitalUsd: number;
  openedAt: Date;
  feesAccrued: number;
  gasSpent: number;
}

// In-memory paper positions (also persisted to DB)
const positions = new Map<string, PaperPosition>();

let positionCounter = 0;

// Counter to throttle DB writes on fee updates
let feeUpdateCounter = 0;

// Call this on startup to restore positions from DB
export async function loadPositionsFromDB(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(lpPositions)
      .where(
        and(eq(lpPositions.isPaper, true), eq(lpPositions.status, "active")),
      );

    positions.clear();
    for (const row of rows) {
      const pos: PaperPosition = {
        id: row.id,
        chain: row.chain as Chain,
        poolAddress: row.poolAddress,
        tickLower: row.tickLower,
        tickUpper: row.tickUpper,
        capitalUsd: parseFloat(row.amount1 || "333"),
        openedAt: row.entryTimestamp,
        feesAccrued: parseFloat(row.amount0 || "0"),
        gasSpent: row.entryGasCostUsd || 0,
      };
      positions.set(pos.id, pos);
      // Restore counter from id to avoid conflicts
      const parts = pos.id.split("-");
      const num = parseInt(parts[2] || "0");
      if (num > positionCounter) positionCounter = num;
    }
    console.log(`[paper-position] Loaded ${positions.size} positions from DB`);
  } catch (err) {
    console.error("[paper-position] Failed to load positions from DB:", err);
  }
}

// Save a position to DB (upsert)
export async function savePositionToDB(pos: PaperPosition): Promise<void> {
  try {
    await db
      .insert(lpPositions)
      .values({
        id: pos.id,
        chain: pos.chain,
        poolAddress: pos.poolAddress,
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        amount0: pos.feesAccrued.toString(), // repurpose for fees
        amount1: pos.capitalUsd.toString(), // repurpose for capital
        isPaper: true,
        status: "active",
        entryTimestamp: pos.openedAt,
        entryGasCostUsd: pos.gasSpent,
      })
      .onConflictDoUpdate({
        target: lpPositions.id,
        set: {
          amount0: pos.feesAccrued.toString(),
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
        },
      });
  } catch (err) {
    // Non-critical
  }
}

// Mark position as closed in DB
export async function closePositionInDB(id: string): Promise<void> {
  try {
    await db
      .update(lpPositions)
      .set({ status: "closed", exitTimestamp: new Date() })
      .where(eq(lpPositions.id, id));
  } catch (err) {
    // Non-critical
  }
}

export function openPaperPosition(
  chain: Chain,
  tickLower: number,
  tickUpper: number,
  capitalUsd: number,
): PaperPosition {
  const id = `paper-${chain}-${++positionCounter}-${Date.now()}`;
  const pos: PaperPosition = {
    id,
    chain,
    poolAddress: EXECUTION_POOL_ADDRESSES[chain],
    tickLower,
    tickUpper,
    capitalUsd,
    openedAt: new Date(),
    feesAccrued: 0,
    gasSpent: 0,
  };
  positions.set(id, pos);
  savePositionToDB(pos).catch(() => {});
  return pos;
}

export function closePaperPosition(id: string): PaperPosition | null {
  const pos = positions.get(id);
  if (pos) {
    positions.delete(id);
    closePositionInDB(id).catch(() => {});
  }
  return pos || null;
}

export function updatePaperFees(id: string, hourlyFees: number): void {
  const pos = positions.get(id);
  if (pos) {
    pos.feesAccrued += hourlyFees;
    feeUpdateCounter++;
    // Only persist every 10th update to avoid DB spam
    if (feeUpdateCounter % 10 === 0) {
      savePositionToDB(pos).catch(() => {});
    }
  }
}

export function getAllPositions(): PaperPosition[] {
  return Array.from(positions.values());
}

export function getPosition(id: string): PaperPosition | undefined {
  return positions.get(id);
}

export function isInRange(pos: PaperPosition, currentTick: number): boolean {
  return pos.tickLower <= currentTick && currentTick <= pos.tickUpper;
}
