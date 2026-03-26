import { useCallback } from "react";
import { fetchJSON, AIDecision } from "../lib/api";
import { usePolling } from "../hooks/usePolling";

const DECISION_COLORS: Record<string, string> = {
  REBALANCE: "bg-orange-900 text-orange-300",
  WAIT: "bg-gray-800 text-gray-300",
  OPEN_POSITION: "bg-green-900 text-green-300",
  CLOSE_POSITION: "bg-red-900 text-red-300",
  DEPEG_EXIT: "bg-red-800 text-red-200",
  PREEMPTIVE_REBALANCE: "bg-yellow-900 text-yellow-300",
  rebalance_check: "bg-blue-900 text-blue-300",
};

export default function AIDecisions() {
  const fetcher = useCallback(
    () => fetchJSON<{ decisions: AIDecision[] }>("/ai-decisions"),
    [],
  );
  const { data, loading } = usePolling(fetcher, 15000);

  const decisions = data?.decisions ?? [];

  if (loading) {
    return (
      <div className="text-gray-500 text-center py-20">
        Loading AI decisions...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">AI Decision Log</h2>
        <span className="text-sm text-gray-400">
          {decisions.length} decisions
        </span>
      </div>

      {decisions.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
          <p className="text-gray-400">No AI decisions logged yet</p>
          <p className="text-gray-600 text-sm mt-1">
            Strategy engine logs every decision — rebalance, wait, exit
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.map((d) => (
            <div
              key={d.id}
              className="bg-gray-900 rounded-xl p-4 border border-gray-800"
            >
              <div className="flex items-center gap-3 mb-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${DECISION_COLORS[d.decisionType] ?? "bg-gray-800 text-gray-300"}`}
                >
                  {d.decisionType}
                </span>
                <span className="text-xs text-gray-500 capitalize">
                  {d.chain}
                </span>
                <span className="text-xs text-gray-600 font-mono">
                  {d.poolAddress?.slice(0, 8)}…
                </span>
                <span className="text-xs text-gray-600 ml-auto">
                  {new Date(d.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-sm text-gray-300">{d.reasoning}</p>
              {d.outcomeUsd !== 0 && d.outcomeUsd != null && (
                <p
                  className={`text-xs mt-1 font-medium ${d.outcomeUsd > 0 ? "text-green-400" : "text-red-400"}`}
                >
                  Outcome: {d.outcomeUsd > 0 ? "+" : ""}$
                  {d.outcomeUsd.toFixed(4)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
