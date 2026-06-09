import React, { useState, useEffect, useMemo, useCallback } from "react";

// ---------------------------------------------------------------------------
// Mock market data
// ---------------------------------------------------------------------------
const STOCK_DATA = {
  NVDA: { price: 131, beta: 1.75, sector: "Technology" },
  AAPL: { price: 211, beta: 1.2, sector: "Technology" },
  MSFT: { price: 450, beta: 0.9, sector: "Technology" },
  TSLA: { price: 248, beta: 2.1, sector: "Consumer Discretionary" },
  GOOGL: { price: 178, beta: 1.05, sector: "Communication Services" },
  AMZN: { price: 205, beta: 1.15, sector: "Consumer Discretionary" },
  META: { price: 607, beta: 1.35, sector: "Communication Services" },
  AMD: { price: 164, beta: 1.85, sector: "Technology" },
  INTC: { price: 20, beta: 0.95, sector: "Technology" },
  VRT: { price: 94, beta: 1.6, sector: "Industrials" },
  MU: { price: 112, beta: 1.7, sector: "Technology" },
  TSM: { price: 175, beta: 1.3, sector: "Technology" },
};

const ACCENT = "#6366F1";
const TEAL = "#14B8A6";
const ROSE = "#F43F5E";

const SLICE_COLORS = [
  "#6366F1", "#14B8A6", "#F59E0B", "#F43F5E", "#8B5CF6",
  "#06B6D4", "#84CC16", "#EC4899", "#F97316", "#3B82F6",
];

const MAX_HOLDINGS = 10;
const GAUGE_MAX_BETA = 2.5; // score range 0 → 2+ mapped across the arc

const SUGGESTION_SYSTEM_PROMPT = `You are a concise equity research assistant. Given a user's portfolio details, return ONLY a valid JSON array of 4 stock suggestions. No preamble, no markdown, no backticks — raw JSON only. Each object must have exactly: ticker (string), company (string), action ("Buy" or "Hold"), risk_level ("Low", "Medium", or "High"), sector (string), rationale (string, 2 sentences max). Suggest stocks that complement or balance the portfolio — prioritise diversification, sector gaps, and appropriate risk level.`;

// ---------------------------------------------------------------------------
// Portfolio math
// ---------------------------------------------------------------------------
function computePortfolio(holdings) {
  const totalValue = holdings.reduce(
    (sum, h) => sum + STOCK_DATA[h.ticker].price * h.qty,
    0
  );
  const rows = holdings.map((h) => {
    const { price, beta, sector } = STOCK_DATA[h.ticker];
    const value = price * h.qty;
    return {
      ...h,
      price,
      beta,
      sector,
      value,
      weight: totalValue > 0 ? value / totalValue : 0,
    };
  });
  const portfolioBeta = rows.reduce((sum, r) => sum + r.beta * r.weight, 0);

  const sectorMap = {};
  for (const r of rows) sectorMap[r.sector] = (sectorMap[r.sector] || 0) + r.weight;
  const sectors = Object.entries(sectorMap)
    .map(([name, weight]) => ({ name, weight }))
    .sort((a, b) => b.weight - a.weight);

  const topHolding = rows.reduce((a, b) => (b.weight > a.weight ? b : a), rows[0]);

  return { rows, totalValue, portfolioBeta, sectors, topHolding };
}

function buildPortfolioSummary({ rows, totalValue, portfolioBeta, sectors, topHolding }) {
  const lines = [];
  lines.push("My current stock portfolio:");
  for (const r of rows) {
    lines.push(
      `- ${r.ticker} x ${r.qty} shares @ $${r.price} = $${r.value.toLocaleString()} ` +
        `(${(r.weight * 100).toFixed(1)}% of portfolio, beta ${r.beta}, sector ${r.sector})`
    );
  }
  lines.push(`Total portfolio value: $${totalValue.toLocaleString()}`);
  lines.push(`Weighted portfolio beta vs S&P 500: ${portfolioBeta.toFixed(2)}`);
  lines.push(
    "Sector weights: " +
      sectors.map((s) => `${s.name} ${(s.weight * 100).toFixed(1)}%`).join(", ")
  );
  if (topHolding.weight > 0.25) {
    lines.push(
      `Concentration warning: ${topHolding.ticker} is ${(topHolding.weight * 100).toFixed(1)}% of the portfolio (over 25%).`
    );
  }
  const topSector = sectors[0];
  if (topSector && topSector.weight > 0.6) {
    lines.push(
      `Sector concentration warning: ${(topSector.weight * 100).toFixed(1)}% of the portfolio is in ${topSector.name} (over 60%).`
    );
  }
  lines.push(
    "Please suggest 4 stocks that would complement or balance this portfolio."
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Anthropic API call
// ---------------------------------------------------------------------------
async function fetchSuggestions(userPortfolioSummary) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: SUGGESTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPortfolioSummary }],
    }),
  });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  const data = await response.json();
  const text = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    // Defensive: pull the array out if the model added any stray text
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse suggestions");
  }
}

// ---------------------------------------------------------------------------
// UI primitives
// ---------------------------------------------------------------------------
function Card({ children, className = "" }) {
  return (
    <div
      className={`rounded-xl border bg-white/[0.04] p-5 ${className}`}
      style={{ borderColor: "#ffffff0a", backdropFilter: "blur(8px)" }}
    >
      {children}
    </div>
  );
}

function CardTitle({ children, badge }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {children}
      </h3>
      {badge}
    </div>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return (
    <div
      className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-xl border px-4 py-2.5 text-sm font-semibold text-rose-100 shadow-xl"
      style={{ background: "#2a121b", borderColor: ROSE + "55" }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk Gauge (hero) — animated SVG semicircle
// ---------------------------------------------------------------------------
function RiskGauge({ beta }) {
  // Needle starts at 0 and eases to the target on mount and every change.
  const [angle, setAngle] = useState(-90);
  useEffect(() => {
    const clamped = Math.max(0, Math.min(beta, GAUGE_MAX_BETA));
    const target = (clamped / GAUGE_MAX_BETA) * 180 - 90;
    const raf = requestAnimationFrame(() => setAngle(target));
    return () => cancelAnimationFrame(raf);
  }, [beta]);

  const cx = 160;
  const cy = 150;
  const r = 118;
  const ticks = [0, 0.5, 1.0, 1.5, 2.0, 2.5];

  return (
    <svg viewBox="0 0 320 190" className="w-full max-w-md" role="img" aria-label={`Risk gauge: portfolio beta ${beta.toFixed(2)}`}>
      <defs>
        <linearGradient id="riskArc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22C55E" />
          <stop offset="50%" stopColor="#EAB308" />
          <stop offset="100%" stopColor={ROSE} />
        </linearGradient>
      </defs>

      {/* track */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="#ffffff0f"
        strokeWidth="22"
        strokeLinecap="round"
      />
      {/* coloured arc */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="url(#riskArc)"
        strokeWidth="14"
        strokeLinecap="round"
      />

      {/* tick labels */}
      {ticks.map((t) => {
        const a = ((t / GAUGE_MAX_BETA) * 180 - 180) * (Math.PI / 180);
        const tx = cx + Math.cos(a) * (r - 30);
        const ty = cy + Math.sin(a) * (r - 30);
        return (
          <text
            key={t}
            x={tx}
            y={ty}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#64748B"
            fontSize="10"
            fontWeight="600"
          >
            {t === GAUGE_MAX_BETA ? "2+" : t}
          </text>
        );
      })}

      {/* needle */}
      <g
        style={{
          transform: `rotate(${angle}deg)`,
          transformOrigin: `${cx}px ${cy}px`,
          transition: "transform 900ms cubic-bezier(0.34, 1.3, 0.5, 1)",
        }}
      >
        <polygon
          points={`${cx - 5},${cy} ${cx + 5},${cy} ${cx},${cy - r + 38}`}
          fill="#E2E8F0"
        />
        <circle cx={cx} cy={cy} r="10" fill={ACCENT} />
        <circle cx={cx} cy={cy} r="4" fill="#0D0F14" />
      </g>

      {/* score */}
      <text
        x={cx}
        y={cy + 32}
        textAnchor="middle"
        fill="#F1F5F9"
        fontSize="30"
        fontWeight="700"
      >
        {beta.toFixed(2)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Concentration donut — plain SVG
// ---------------------------------------------------------------------------
function ConcentrationDonut({ rows }) {
  const size = 168;
  const c = size / 2;
  const radius = 60;
  const circ = 2 * Math.PI * radius;

  let offset = 0;
  const segments = rows.map((r, i) => {
    const seg = { row: r, color: SLICE_COLORS[i % SLICE_COLORS.length], start: offset };
    offset += r.weight;
    return seg;
  });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-40 shrink-0">
        <circle cx={c} cy={c} r={radius} fill="none" stroke="#ffffff0f" strokeWidth="22" />
        {segments.map((s) => (
          <circle
            key={s.row.ticker}
            cx={c}
            cy={c}
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth="22"
            strokeDasharray={`${Math.max(s.row.weight * circ - 2, 0.5)} ${circ}`}
            strokeDashoffset={-s.start * circ}
            transform={`rotate(-90 ${c} ${c})`}
            style={{ transition: "stroke-dasharray 700ms ease, stroke-dashoffset 700ms ease" }}
          />
        ))}
        <text x={c} y={c - 6} textAnchor="middle" fill="#F1F5F9" fontSize="22" fontWeight="700">
          {rows.length}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" fill="#64748B" fontSize="10" fontWeight="600">
          {rows.length === 1 ? "HOLDING" : "HOLDINGS"}
        </text>
      </svg>
      <ul className="w-full space-y-1.5 text-sm">
        {segments.map((s) => (
          <li key={s.row.ticker} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="font-semibold text-slate-200">{s.row.ticker}</span>
            <span className="ml-auto font-semibold tabular-nums text-slate-400">
              {(s.row.weight * 100).toFixed(1)}%
            </span>
            {s.row.weight > 0.25 && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                style={{ background: ROSE + "22", color: ROSE }}
              >
                &gt;25%
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sector exposure — horizontal SVG bars
// ---------------------------------------------------------------------------
function SectorBars({ sectors }) {
  const rowH = 38;
  const chartW = 300;
  const barX = 0;
  const height = sectors.length * rowH;

  return (
    <svg
      viewBox={`0 0 ${chartW} ${height}`}
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      {sectors.map((s, i) => {
        const y = i * rowH;
        const w = Math.max(s.weight * chartW, 2);
        const flagged = s.weight > 0.6;
        return (
          <g key={s.name}>
            <text x={barX} y={y + 11} fill="#94A3B8" fontSize="11" fontWeight="600">
              {s.name}
              {flagged ? "  ⚠" : ""}
            </text>
            <rect x={barX} y={y + 17} width={chartW} height="10" rx="5" fill="#ffffff0f" />
            <rect
              x={barX}
              y={y + 17}
              width={w}
              height="10"
              rx="5"
              fill={flagged ? ROSE : ACCENT}
              style={{ transition: "width 700ms ease, fill 400ms ease" }}
            />
            <text
              x={chartW}
              y={y + 11}
              textAnchor="end"
              fill={flagged ? ROSE : "#E2E8F0"}
              fontSize="11"
              fontWeight="700"
            >
              {(s.weight * 100).toFixed(1)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Volatility verdict
// ---------------------------------------------------------------------------
function buildVerdict({ portfolioBeta, topHolding, sectors }) {
  const parts = [];
  if (portfolioBeta > 1.05) {
    parts.push(
      `Your portfolio is ${portfolioBeta.toFixed(1)}× more volatile than the S&P 500.`
    );
  } else if (portfolioBeta < 0.95) {
    parts.push(
      `Your portfolio is more defensive than the market, at ${portfolioBeta.toFixed(2)}× the volatility of the S&P 500.`
    );
  } else {
    parts.push(
      `Your portfolio moves roughly in line with the S&P 500 (beta ${portfolioBeta.toFixed(2)}).`
    );
  }

  const topSector = sectors[0];
  if (topSector && topSector.weight > 0.6) {
    parts.push(
      `High ${topSector.name.toLowerCase()} concentration (${(topSector.weight * 100).toFixed(0)}%) adds tail risk.`
    );
  }
  if (topHolding.weight > 0.25) {
    parts.push(
      `${topHolding.ticker} alone is ${(topHolding.weight * 100).toFixed(0)}% of your holdings — a single-name shock would hit hard.`
    );
  }
  if (parts.length === 1) {
    parts.push("Diversification across names and sectors looks reasonable.");
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// AI suggestions
// ---------------------------------------------------------------------------
function SuggestionSkeleton() {
  return (
    <div
      className="animate-pulse rounded-xl border bg-white/[0.04] p-4"
      style={{ borderColor: "#ffffff0a" }}
    >
      <div className="mb-3 flex items-center gap-2">
        <div className="h-7 w-16 rounded-lg bg-white/10" />
        <div className="h-5 w-12 rounded-md bg-white/10" />
        <div className="ml-auto h-5 w-16 rounded-md bg-white/10" />
      </div>
      <div className="mb-2 h-3 w-3/4 rounded bg-white/10" />
      <div className="h-3 w-full rounded bg-white/[0.07]" />
      <div className="mt-1.5 h-3 w-5/6 rounded bg-white/[0.07]" />
    </div>
  );
}

function SuggestionCard({ suggestion }) {
  const { ticker, company, action, risk_level, sector, rationale } = suggestion;
  const isBuy = action === "Buy";
  const riskColor =
    risk_level === "High" ? ROSE : risk_level === "Medium" ? "#F59E0B" : TEAL;

  return (
    <div
      className="rounded-xl border bg-white/[0.04] p-4 transition-colors hover:bg-white/[0.06]"
      style={{ borderColor: "#ffffff0a", backdropFilter: "blur(8px)" }}
    >
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <span
          className="rounded-lg px-2.5 py-1 text-sm font-bold tracking-wide"
          style={{ background: ACCENT + "26", color: "#A5B4FC" }}
        >
          {ticker}
        </span>
        <span
          className="rounded-md px-2 py-0.5 text-xs font-bold"
          style={{
            background: (isBuy ? TEAL : "#3B82F6") + "22",
            color: isBuy ? TEAL : "#60A5FA",
          }}
        >
          {action}
        </span>
        <span
          className="ml-auto rounded-md px-2 py-0.5 text-xs font-semibold"
          style={{ background: riskColor + "1f", color: riskColor }}
        >
          {risk_level} risk
        </span>
      </div>
      <p className="text-sm font-semibold text-slate-200">
        {company} <span className="font-medium text-slate-500">· {sector}</span>
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{rationale}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function Riskometer() {
  const [holdings, setHoldings] = useState([]);
  const [tickerInput, setTickerInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [toast, setToast] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const portfolio = useMemo(
    () => (holdings.length ? computePortfolio(holdings) : null),
    [holdings]
  );

  const addHolding = useCallback(
    (e) => {
      e.preventDefault();
      const ticker = tickerInput.trim().toUpperCase();
      const qty = Math.floor(Number(qtyInput));
      if (!ticker || !qty || qty <= 0) return;
      if (!STOCK_DATA[ticker]) {
        setToast("Ticker not found");
        return;
      }
      setHoldings((prev) => {
        const existing = prev.find((h) => h.ticker === ticker);
        if (existing) {
          return prev.map((h) =>
            h.ticker === ticker ? { ...h, qty: h.qty + qty } : h
          );
        }
        if (prev.length >= MAX_HOLDINGS) {
          setToast(`Maximum ${MAX_HOLDINGS} stocks`);
          return prev;
        }
        return [...prev, { ticker, qty }];
      });
      setTickerInput("");
      setQtyInput("");
    },
    [tickerInput, qtyInput]
  );

  const removeHolding = useCallback((ticker) => {
    setHoldings((prev) => prev.filter((h) => h.ticker !== ticker));
  }, []);

  const getSuggestions = useCallback(async () => {
    if (!portfolio) return;
    setLoadingSuggestions(true);
    setSuggestionError("");
    try {
      const summary = buildPortfolioSummary(portfolio);
      const result = await fetchSuggestions(summary);
      setSuggestions(Array.isArray(result) ? result.slice(0, 4) : []);
    } catch {
      setSuggestionError("Couldn't fetch suggestions — try again.");
    } finally {
      setLoadingSuggestions(false);
    }
  }, [portfolio]);

  const verdict = portfolio ? buildVerdict(portfolio) : "";
  const concentrated = portfolio && portfolio.topHolding.weight > 0.25;

  return (
    <div
      className="min-h-screen px-4 py-8 text-slate-100 sm:px-8"
      style={{ background: "#0D0F14", fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
      />
      <Toast message={toast} />

      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            <span style={{ color: ACCENT }}>Risk</span>ometer
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Understand your portfolio's risk relative to the market.
          </p>
        </header>

        {/* Portfolio input */}
        <Card className="mb-6">
          <CardTitle>Portfolio</CardTitle>
          <form onSubmit={addHolding} className="flex flex-wrap items-center gap-2">
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder="Ticker (e.g. NVDA)"
              className="w-40 rounded-xl border bg-white/[0.04] px-3 py-2 text-sm font-semibold uppercase placeholder:font-normal placeholder:normal-case placeholder:text-slate-500 focus:outline-none focus:ring-2"
              style={{ borderColor: "#ffffff0a", "--tw-ring-color": ACCENT }}
              maxLength={6}
              aria-label="Ticker symbol"
            />
            <span className="text-slate-500">×</span>
            <input
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              placeholder="Qty"
              type="number"
              min="1"
              step="1"
              className="w-24 rounded-xl border bg-white/[0.04] px-3 py-2 text-sm font-semibold placeholder:font-normal placeholder:text-slate-500 focus:outline-none focus:ring-2"
              style={{ borderColor: "#ffffff0a", "--tw-ring-color": ACCENT }}
              aria-label="Quantity"
            />
            <button
              type="submit"
              className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: ACCENT }}
            >
              Add
            </button>
            <span className="ml-auto text-xs font-medium text-slate-500">
              {holdings.length}/{MAX_HOLDINGS} stocks
            </span>
          </form>

          {/* Chips */}
          {holdings.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {holdings.map((h) => (
                <span
                  key={h.ticker}
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold"
                  style={{ borderColor: ACCENT + "44", background: ACCENT + "14" }}
                >
                  {h.ticker}
                  <span className="font-medium text-slate-400">× {h.qty}</span>
                  <button
                    onClick={() => removeHolding(h.ticker)}
                    aria-label={`Remove ${h.ticker}`}
                    className="ml-0.5 text-slate-400 transition-colors hover:text-rose-400"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Empty state */}
        {!portfolio && (
          <div
            className="rounded-xl border border-dashed py-20 text-center"
            style={{ borderColor: "#ffffff14" }}
          >
            <p className="text-3xl">📊</p>
            <p className="mt-3 font-semibold text-slate-300">
              Add your stocks to see your risk profile
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Try NVDA, AAPL, MSFT, TSLA…
            </p>
          </div>
        )}

        {/* Dashboard */}
        {portfolio && (
          <>
            {/* Hero gauge */}
            <Card className="mb-6 flex flex-col items-center pb-2 pt-8">
              <RiskGauge beta={portfolio.portfolioBeta} />
              <p className="-mt-2 mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Portfolio beta vs S&amp;P 500
              </p>
            </Card>

            <div className="mb-6 grid gap-6 md:grid-cols-2">
              {/* Beta table */}
              <Card>
                <CardTitle>Portfolio Beta</CardTitle>
                <div className="mb-4 flex items-baseline gap-2">
                  <span className="text-3xl font-bold" style={{ color: ACCENT }}>
                    {portfolio.portfolioBeta.toFixed(2)}
                  </span>
                  <span className="text-xs font-medium text-slate-500">
                    weighted avg · ${portfolio.totalValue.toLocaleString()} total
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      <th className="pb-2">Stock</th>
                      <th className="pb-2 text-right">Beta</th>
                      <th className="pb-2 text-right">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.rows.map((r) => (
                      <tr key={r.ticker} className="border-t" style={{ borderColor: "#ffffff0a" }}>
                        <td className="py-2 font-semibold text-slate-200">{r.ticker}</td>
                        <td
                          className="py-2 text-right font-semibold tabular-nums"
                          style={{ color: r.beta > 1.5 ? ROSE : r.beta < 1 ? TEAL : "#E2E8F0" }}
                        >
                          {r.beta.toFixed(2)}
                        </td>
                        <td className="py-2 text-right font-medium tabular-nums text-slate-400">
                          {(r.weight * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {/* Concentration */}
              <Card>
                <CardTitle
                  badge={
                    concentrated ? (
                      <span
                        className="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: ROSE + "22", color: ROSE }}
                      >
                        ⚠ {portfolio.topHolding.ticker} exceeds 25%
                      </span>
                    ) : null
                  }
                >
                  Concentration Risk
                </CardTitle>
                <ConcentrationDonut rows={portfolio.rows} />
              </Card>

              {/* Sector exposure */}
              <Card>
                <CardTitle
                  badge={
                    portfolio.sectors[0].weight > 0.6 ? (
                      <span
                        className="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: ROSE + "22", color: ROSE }}
                      >
                        ⚠ &gt;60% one sector
                      </span>
                    ) : null
                  }
                >
                  Sector Exposure
                </CardTitle>
                <SectorBars sectors={portfolio.sectors} />
              </Card>

              {/* Verdict */}
              <Card>
                <CardTitle>Volatility Verdict</CardTitle>
                <div className="flex h-full flex-col">
                  <p className="text-[15px] font-medium leading-relaxed text-slate-200">
                    {verdict}
                  </p>
                  <div className="mt-auto flex items-center gap-2 pt-4 text-xs font-semibold">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        background:
                          portfolio.portfolioBeta > 1.5
                            ? ROSE
                            : portfolio.portfolioBeta > 1.1
                              ? "#F59E0B"
                              : TEAL,
                      }}
                    />
                    <span className="text-slate-400">
                      {portfolio.portfolioBeta > 1.5
                        ? "High volatility"
                        : portfolio.portfolioBeta > 1.1
                          ? "Above-market volatility"
                          : portfolio.portfolioBeta < 0.9
                            ? "Defensive"
                            : "Market-like volatility"}
                    </span>
                  </div>
                </div>
              </Card>
            </div>

            {/* AI suggestions */}
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    AI Stock Suggestions
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Powered by Claude · based on your beta, sectors and concentration
                  </p>
                </div>
                <button
                  onClick={getSuggestions}
                  disabled={loadingSuggestions}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: ACCENT }}
                >
                  {loadingSuggestions
                    ? "Analysing…"
                    : suggestions
                      ? "Refresh"
                      : "Get Suggestions"}
                </button>
              </div>

              {suggestionError && (
                <p className="mb-4 text-sm font-medium" style={{ color: ROSE }}>
                  {suggestionError}
                </p>
              )}

              {loadingSuggestions && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <SuggestionSkeleton key={i} />
                  ))}
                </div>
              )}

              {!loadingSuggestions && suggestions && (
                <div className="grid gap-4 sm:grid-cols-2">
                  {suggestions.map((s) => (
                    <SuggestionCard key={s.ticker} suggestion={s} />
                  ))}
                </div>
              )}

              {!loadingSuggestions && !suggestions && !suggestionError && (
                <p className="py-6 text-center text-sm text-slate-500">
                  Get AI-powered ideas to balance your portfolio.
                </p>
              )}
            </Card>
          </>
        )}

        <footer className="mt-10 text-center text-xs text-slate-600">
          Mock data · not investment advice
        </footer>
      </div>
    </div>
  );
}
