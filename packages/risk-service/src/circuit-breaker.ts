import fetch from "node-fetch";
import { sendAlert } from "./alerts.js";

const EXECUTION_ENGINE_URL =
  process.env.EXECUTION_ENGINE_URL || "http://localhost:4003";

export interface CircuitBreakerResult {
  success: boolean;
  positionsClosed: number;
  reason: string;
}

export async function emergencyExit(
  reason: string,
): Promise<CircuitBreakerResult> {
  console.log(`[circuit-breaker] EMERGENCY EXIT: ${reason}`);
  await sendAlert(`EMERGENCY EXIT triggered: ${reason}`, "critical");

  try {
    // Signal execution engine to close all positions
    const res = await fetch(`${EXECUTION_ENGINE_URL}/positions/close-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      return {
        success: true,
        positionsClosed: data.closed || 0,
        reason,
      };
    } else {
      console.error("[circuit-breaker] Execution engine returned:", res.status);
      return { success: false, positionsClosed: 0, reason };
    }
  } catch (err) {
    console.error("[circuit-breaker] Failed to reach execution engine:", err);
    return { success: false, positionsClosed: 0, reason };
  }
}
