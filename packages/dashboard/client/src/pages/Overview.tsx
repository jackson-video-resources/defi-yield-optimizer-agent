import { useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { fetchJSON, PortfolioSnapshot, QhvnBenchmark } from "../lib/api";
import { usePolling } from "../hooks/usePolling";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Overview() {
  const portfolioFetcher = useCallback(
    () =>
      fetchJSON<{ snapshots: PortfolioSnapshot[]; latest: PortfolioSnapshot }>(
        "/portfolio",
      ),
    [],
  );
  const qhvnFetcher = useCallback(
    () => fetchJSON<{ data: QhvnBenchmark[] }>("/qhvn-benchmark"),
    [],
  );

  const { data: portfolio, loading: pLoading } = usePolling(
    portfolioFetcher,
    30000,
  );
  const { data: qhvn } = usePolling(qhvnFetcher, 60000);

  const latest = portfolio?.latest;

  // Build chart data — align by day
  const chartData = (() => {
    if (!portfolio?.snapshots?.length) return [];
    const snapsByDay: Record<
      string,
      { aiReturn: number; qhvnReturn: number; date: string }
    > = {};

    // Use first valid snapshot as baseline (not hardcoded $10K)
    const validSnaps = portfolio.snapshots.filter((s) => s.totalValueUsd > 0);
    if (!validSnaps.length) return [];
    const initialCapital = validSnaps[0].totalValueUsd;
    for (const snap of validSnaps) {
      const date = snap.timestamp.split("T")[0];
      const aiReturn =
        ((snap.totalValueUsd - initialCapital) / initialCapital) * 100;
      snapsByDay[date] = { date, aiReturn, qhvnReturn: 0 };
    }

    if (qhvn?.data) {
      for (const q of qhvn.data) {
        if (snapsByDay[q.date]) {
          snapsByDay[q.date].qhvnReturn = q.cumulativeReturnPct;
        }
      }
    }

    return Object.values(snapsByDay).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  })();

  if (pLoading) {
    return (
      <div className="text-gray-500 text-center py-20">
        Loading portfolio data...
      </div>
    );
  }

  const apy = latest?.apyCurrent ?? 0;
  const netPnl = latest?.netPnlUsd ?? 0;
  const fees = latest?.feesEarnedUsd ?? 0;
  const gas = latest?.gasSpentUsd ?? 0;
  const drawdown = latest?.drawdownPct ?? 0;

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="APY" value={`${apy.toFixed(2)}%`} sub="Annualized" />
        <StatCard
          label="Net P&L"
          value={`$${netPnl.toFixed(2)}`}
          sub="Fees − Gas"
        />
        <StatCard label="Fees Earned" value={`$${fees.toFixed(2)}`} />
        <StatCard label="Gas Spent" value={`$${gas.toFixed(2)}`} />
        <StatCard
          label="Drawdown"
          value={`${drawdown.toFixed(3)}%`}
          sub="From peak"
        />
        <StatCard
          label="vs QHVN"
          value={`+${(apy - -41.56).toFixed(1)}%`}
          sub="APY advantage"
        />
      </div>

      {/* P&L Chart */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-lg font-semibold text-white mb-4">
          Cumulative Return — AI vs QHVN
        </h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
                tickFormatter={(v) => v.slice(5)} // MM-DD
              />
              <YAxis
                tick={{ fill: "#9CA3AF", fontSize: 11 }}
                tickFormatter={(v) => `${v.toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{
                  background: "#111827",
                  border: "1px solid #374151",
                  borderRadius: 8,
                }}
                labelStyle={{ color: "#F3F4F6" }}
                formatter={(v: number) => [`${v.toFixed(3)}%`]}
              />
              <Legend wrapperStyle={{ color: "#9CA3AF" }} />
              <Line
                type="monotone"
                dataKey="aiReturn"
                name="AI Strategy"
                stroke="#3B82F6"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="qhvnReturn"
                name="QHVN (Fixed 4h)"
                stroke="#EF4444"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 flex items-center justify-center">
            <div className="text-center">
              <p className="text-gray-400">
                Paper trading active — collecting data
              </p>
              <p className="text-gray-600 text-sm mt-1">
                Chart will populate after first portfolio snapshots
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Backtest callout */}
      <div className="bg-blue-950 border border-blue-800 rounded-xl p-4">
        <p className="text-blue-200 font-semibold">
          Backtest Results (6 months historical data)
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
          {[
            { label: "AI APY", value: "1.73%", note: "No rebalances needed" },
            { label: "QHVN APY", value: "−41.56%", note: "1,086 rebalances" },
            {
              label: "APY Advantage",
              value: "+43.3pp",
              note: "vs QHVN baseline",
            },
            {
              label: "QHVN Gas Cost",
              value: "$2,172",
              note: "Kills their yield",
            },
          ].map(({ label, value, note }) => (
            <div key={label}>
              <p className="text-xs text-blue-400 uppercase">{label}</p>
              <p className="text-xl font-bold text-white">{value}</p>
              <p className="text-xs text-blue-500">{note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
