import { Routes, Route, NavLink } from "react-router-dom";
import Overview from "./pages/Overview";
import Positions from "./pages/Positions";
import AIDecisions from "./pages/AIDecisions";
import RiskPanel from "./pages/RiskPanel";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">DeFi LP Engine</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Beating QHVN on Uniswap V3
            </p>
          </div>
          <nav className="flex gap-1">
            {[
              { to: "/", label: "Overview" },
              { to: "/positions", label: "Positions" },
              { to: "/ai-decisions", label: "AI Decisions" },
              { to: "/risk", label: "Risk" },
            ].map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-blue-600 text-white"
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/positions" element={<Positions />} />
          <Route path="/ai-decisions" element={<AIDecisions />} />
          <Route path="/risk" element={<RiskPanel />} />
        </Routes>
      </main>
    </div>
  );
}
