import { useCallback } from "react";
import { fetchJSON } from "../lib/api";
import { usePolling } from "../hooks/usePolling";

interface DepegStatus {
  timestamp: string;
  statuses: Array<{
    symbol: string;
    price: number;
    deviationPct: number;
    status: "ok" | "warning" | "danger";
  }>;
  maxDeviation: number;
  dangerCount: number;
  action: "none" | "widen" | "exit";
}

interface DrawdownState {
  currentValueUsd: number;
  highWaterMarkUsd: number;
  drawdownPct: number;
  drawdownUsd: number;
  feesEarnedTotal: number;
  gasSpentTotal: number;
  netPnlUsd: number;
  gasSpentToday: number;
}

interface KillSwitchStatus {
  active: boolean;
  reason?: string;
}

const STATUS_COLORS = {
  ok: "text-green-400",
  warning: "text-yellow-400",
  danger: "text-red-400",
};

export default function RiskPanel() {
  const depegFetcher = useCallback(() => fetchJSON<DepegStatus>("/depeg"), []);
  const drawdownFetcher = useCallback(
    () => fetchJSON<DrawdownState>("/drawdown"),
    [],
  );
  const ksFetcher = useCallback(
    () => fetchJSON<KillSwitchStatus>("/kill-switch"),
    [],
  );

  const { data: depeg } = usePolling(depegFetcher, 30000);
  const { data: drawdown } = usePolling(drawdownFetcher, 15000);
  const { data: ks } = usePolling(ksFetcher, 15000);

  return (
    <div className="space-y-6">
      {/* Kill Switch */}
      <div
        className={`rounded-xl p-5 border ${ks?.active ? "bg-red-950 border-red-700" : "bg-gray-900 border-gray-800"}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">Kill Switch</h3>
            <p
              className={`text-sm mt-0.5 ${ks?.active ? "text-red-300" : "text-green-400"}`}
            >
              {ks?.active
                ? `ACTIVE — ${ks.reason}`
                : "Inactive — System nominal"}
            </p>
          </div>
          <div
            className={`w-4 h-4 rounded-full ${ks?.active ? "bg-red-500 animate-pulse" : "bg-green-500"}`}
          />
        </div>
      </div>

      {/* Drawdown Monitor */}
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <h3 className="font-semibold text-white mb-4">Portfolio Risk</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Drawdown",
              value: `${(drawdown?.drawdownPct ?? 0).toFixed(3)}%`,
              warn: (drawdown?.drawdownPct ?? 0) > 0.5,
            },
            {
              label: "Current Value",
              value: `$${(drawdown?.currentValueUsd ?? 0).toFixed(2)}`,
              warn: false,
            },
            {
              label: "High Water Mark",
              value: `$${(drawdown?.highWaterMarkUsd ?? 0).toFixed(2)}`,
              warn: false,
            },
            {
              label: "Gas Today",
              value: `$${(drawdown?.gasSpentToday ?? 0).toFixed(2)}`,
              warn: (drawdown?.gasSpentToday ?? 0) > 15,
            },
          ].map(({ label, value, warn }) => (
            <div key={label}>
              <p className="text-xs text-gray-500 uppercase">{label}</p>
              <p
                className={`text-xl font-bold mt-0.5 ${warn ? "text-yellow-400" : "text-white"}`}
              >
                {value}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Depeg Status */}
      <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white">Stablecoin Peg Status</h3>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              depeg?.action === "exit"
                ? "bg-red-900 text-red-300"
                : depeg?.action === "widen"
                  ? "bg-yellow-900 text-yellow-300"
                  : "bg-green-900 text-green-300"
            }`}
          >
            {depeg?.action === "none"
              ? "All Normal"
              : (depeg?.action?.toUpperCase() ?? "Loading")}
          </span>
        </div>

        <div className="space-y-2">
          {(depeg?.statuses ?? []).map((s) => (
            <div
              key={s.symbol}
              className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
            >
              <span className="text-white font-medium w-16">{s.symbol}</span>
              <span className="text-gray-400 text-sm font-mono">
                ${s.price.toFixed(6)}
              </span>
              <span
                className={`text-sm font-medium ${STATUS_COLORS[s.status]}`}
              >
                {s.deviationPct.toFixed(4)}% dev
              </span>
              <span
                className={`text-xs font-medium ${STATUS_COLORS[s.status]}`}
              >
                {s.status.toUpperCase()}
              </span>
            </div>
          ))}
        </div>

        {depeg && (
          <p className="text-xs text-gray-600 mt-3">
            Last check: {new Date(depeg.timestamp).toLocaleTimeString()} · Max
            deviation: {depeg.maxDeviation.toFixed(4)}%
          </p>
        )}
      </div>
    </div>
  );
}
