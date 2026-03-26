import { useCallback } from "react";
import { fetchJSON } from "../lib/api";
import { usePolling } from "../hooks/usePolling";

interface PaperPosition {
  id: string;
  chain: string;
  poolAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  inRange: boolean;
  feesEarnedUsd: number;
  capitalUsd: number;
  openedAt: string;
}

const CHAIN_COLORS: Record<string, string> = {
  arbitrum: "bg-blue-900 text-blue-300",
  base: "bg-indigo-900 text-indigo-300",
  optimism: "bg-red-900 text-red-300",
};

export default function Positions() {
  const fetcher = useCallback(
    () => fetchJSON<{ positions: PaperPosition[] }>("/positions"),
    [],
  );
  const { data, loading } = usePolling(fetcher, 15000);

  const positions = data?.positions ?? [];

  if (loading) {
    return (
      <div className="text-gray-500 text-center py-20">
        Loading positions...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Active Positions</h2>
        <span className="text-sm text-gray-400">
          {positions.length} positions (paper trading)
        </span>
      </div>

      {positions.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
          <p className="text-gray-400">No open positions yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Strategy engine will open positions on next tick
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {positions.map((pos) => {
            const rangePct =
              pos.tickUpper !== pos.tickLower
                ? ((pos.currentTick - pos.tickLower) /
                    (pos.tickUpper - pos.tickLower)) *
                  100
                : 50;

            return (
              <div
                key={pos.id}
                className="bg-gray-900 rounded-xl p-5 border border-gray-800"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${CHAIN_COLORS[pos.chain] ?? "bg-gray-800 text-gray-300"}`}
                    >
                      {pos.chain}
                    </span>
                    <h3 className="text-white font-semibold mt-1.5">
                      {pos.token0Symbol}/{pos.token1Symbol}
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5 font-mono">
                      {pos.poolAddress.slice(0, 10)}…
                    </p>
                  </div>
                  <span
                    className={`text-sm font-medium px-3 py-1 rounded-full ${
                      pos.inRange
                        ? "bg-green-900 text-green-300"
                        : "bg-yellow-900 text-yellow-300"
                    }`}
                  >
                    {pos.inRange ? "In Range" : "Out of Range"}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs">Capital</p>
                    <p className="text-white font-medium">
                      ${pos.capitalUsd.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Fees Earned</p>
                    <p className="text-green-400 font-medium">
                      ${pos.feesEarnedUsd.toFixed(4)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Tick Range</p>
                    <p className="text-white font-mono text-xs">
                      [{pos.tickLower}, {pos.tickUpper}]
                    </p>
                  </div>
                </div>

                {/* Range bar */}
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Tick {pos.tickLower}</span>
                    <span>Current: {pos.currentTick}</span>
                    <span>Tick {pos.tickUpper}</span>
                  </div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pos.inRange ? "bg-blue-500" : "bg-yellow-500"}`}
                      style={{
                        width: `${Math.max(2, Math.min(98, rangePct))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
