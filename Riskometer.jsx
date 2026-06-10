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
// Self-contained stylesheet — no Tailwind or external CSS required
// ---------------------------------------------------------------------------
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

.rk-root, .rk-root * { box-sizing: border-box; margin: 0; padding: 0; }
.rk-root {
  min-height: 100vh;
  background: #0D0F14;
  color: #F1F5F9;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  padding: 40px 20px 24px;
  -webkit-font-smoothing: antialiased;
}
.rk-shell { max-width: 1040px; margin: 0 auto; }

.rk-header { margin-bottom: 32px; }
.rk-title { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; color: #F1F5F9; }
.rk-subtitle { margin-top: 6px; font-size: 14px; color: #94A3B8; }

.rk-card {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 16px;
  padding: 22px;
  backdrop-filter: blur(8px);
}
.rk-card-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #94A3B8;
}
.rk-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 16px;
}

.rk-toast {
  position: fixed;
  left: 50%;
  top: 24px;
  transform: translateX(-50%);
  z-index: 50;
  background: #2a121b;
  border: 1px solid rgba(244, 63, 94, 0.4);
  border-radius: 12px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  color: #FECDD3;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  animation: rk-toast-in 200ms ease-out;
}
@keyframes rk-toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

.rk-form { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.rk-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  color: #F1F5F9;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.rk-input::placeholder { color: #64748B; font-weight: 400; text-transform: none; }
.rk-input:focus { border-color: ${ACCENT}; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25); }
.rk-input-ticker { width: 168px; text-transform: uppercase; }
.rk-input-qty { width: 96px; }
.rk-input-qty::-webkit-outer-spin-button,
.rk-input-qty::-webkit-inner-spin-button { -webkit-appearance: none; }

.rk-btn {
  background: ${ACCENT};
  border: none;
  border-radius: 12px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  color: #ffffff;
  cursor: pointer;
  transition: opacity 150ms ease, transform 100ms ease;
}
.rk-btn:hover { opacity: 0.88; }
.rk-btn:active { transform: scale(0.97); }
.rk-btn:disabled { opacity: 0.45; cursor: default; transform: none; }

.rk-count { margin-left: auto; font-size: 12px; font-weight: 500; color: #64748B; }

.rk-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.rk-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(99, 102, 241, 0.35);
  background: rgba(99, 102, 241, 0.1);
  border-radius: 12px;
  padding: 7px 12px;
  font-size: 14px;
  font-weight: 600;
  color: #E2E8F0;
}
.rk-chip-qty { font-weight: 500; color: #94A3B8; }
.rk-chip-x {
  background: none;
  border: none;
  padding: 0 0 0 2px;
  font-size: 13px;
  font-family: inherit;
  color: #94A3B8;
  cursor: pointer;
  transition: color 150ms ease;
}
.rk-chip-x:hover { color: #FB7185; }

.rk-empty {
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 80px 20px;
  text-align: center;
}
.rk-empty-icon { font-size: 32px; }
.rk-empty-main { margin-top: 14px; font-size: 16px; font-weight: 600; color: #CBD5E1; }
.rk-empty-hint { margin-top: 6px; font-size: 14px; color: #64748B; }

.rk-grid { display: grid; gap: 22px; grid-template-columns: 1fr; margin-bottom: 22px; }
@media (min-width: 760px) { .rk-grid { grid-template-columns: 1fr 1fr; } }

.rk-gauge-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 32px;
  padding-bottom: 14px;
  margin-bottom: 22px;
}
.rk-gauge-svg { width: 100%; max-width: 420px; display: block; }
.rk-gauge-label {
  margin-top: -4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: #64748B;
}

.rk-beta-big { font-size: 32px; font-weight: 800; color: ${ACCENT}; line-height: 1; }
.rk-beta-meta { font-size: 12px; font-weight: 500; color: #64748B; }
.rk-beta-row { display: flex; align-items: baseline; gap: 10px; margin-bottom: 16px; }

.rk-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.rk-table th {
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748B;
  padding-bottom: 8px;
}
.rk-table th.rk-num, .rk-table td.rk-num { text-align: right; font-variant-numeric: tabular-nums; }
.rk-table td { padding: 9px 0; border-top: 1px solid rgba(255, 255, 255, 0.06); }
.rk-table td:first-child { font-weight: 600; color: #E2E8F0; }
.rk-table td.rk-weight { font-weight: 500; color: #94A3B8; }

.rk-donut-wrap { display: flex; flex-direction: column; align-items: center; gap: 18px; }
@media (min-width: 480px) { .rk-donut-wrap { flex-direction: row; } }
.rk-donut-svg { width: 160px; flex-shrink: 0; }
.rk-legend { width: 100%; list-style: none; display: flex; flex-direction: column; gap: 7px; font-size: 14px; }
.rk-legend li { display: flex; align-items: center; gap: 9px; }
.rk-swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.rk-legend-ticker { font-weight: 600; color: #E2E8F0; }
.rk-legend-pct { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; color: #94A3B8; }

.rk-flag {
  border-radius: 7px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: rgba(244, 63, 94, 0.14);
  color: #FB7185;
  white-space: nowrap;
}

.rk-verdict-card { display: flex; flex-direction: column; }
.rk-verdict { font-size: 15px; font-weight: 500; line-height: 1.65; color: #E2E8F0; }
.rk-verdict-tag { margin-top: auto; display: flex; align-items: center; gap: 8px; padding-top: 18px; font-size: 12px; font-weight: 600; color: #94A3B8; }
.rk-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

.rk-sugg-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.rk-sugg-sub { margin-top: 5px; font-size: 12px; color: #64748B; }
.rk-sugg-grid { display: grid; gap: 14px; grid-template-columns: 1fr; }
@media (min-width: 640px) { .rk-sugg-grid { grid-template-columns: 1fr 1fr; } }

.rk-sugg-card {
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 14px;
  padding: 16px;
  transition: background 150ms ease;
}
.rk-sugg-card:hover { background: rgba(255, 255, 255, 0.06); }
.rk-sugg-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 11px; }
.rk-tag-ticker {
  border-radius: 9px;
  padding: 5px 11px;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.03em;
  background: rgba(99, 102, 241, 0.16);
  color: #A5B4FC;
}
.rk-tag { border-radius: 7px; padding: 3px 9px; font-size: 12px; font-weight: 700; }
.rk-tag-risk { margin-left: auto; font-weight: 600; }
.rk-sugg-company { font-size: 14px; font-weight: 600; color: #E2E8F0; }
.rk-sugg-sector { font-weight: 500; color: #64748B; }
.rk-sugg-rationale { margin-top: 7px; font-size: 14px; line-height: 1.6; color: #94A3B8; }

.rk-error { margin-bottom: 16px; font-size: 14px; font-weight: 500; color: ${ROSE}; }
.rk-sugg-empty { padding: 26px 0; text-align: center; font-size: 14px; color: #64748B; }

.rk-skel { animation: rk-pulse 1.6s ease-in-out infinite; }
@keyframes rk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.rk-skel-bar { background: rgba(255, 255, 255, 0.09); border-radius: 6px; }
.rk-skel-row { display: flex; align-items: center; gap: 8px; margin-bottom: 13px; }

.rk-footer { margin-top: 44px; text-align: center; font-size: 12px; color: #475569; }
`;

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
function Card({ children, className = "", style }) {
  return (
    <div className={`rk-card ${className}`} style={style}>
      {children}
    </div>
  );
}

function CardTitle({ children, badge }) {
  return (
    <div className="rk-card-head">
      <h3 className="rk-card-title">{children}</h3>
      {badge}
    </div>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="rk-toast">{message}</div>;
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
    <svg viewBox="0 0 320 190" className="rk-gauge-svg" role="img" aria-label={`Risk gauge: portfolio beta ${beta.toFixed(2)}`}>
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
    <div className="rk-donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="rk-donut-svg">
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
      <ul className="rk-legend">
        {segments.map((s) => (
          <li key={s.row.ticker}>
            <span className="rk-swatch" style={{ background: s.color }} />
            <span className="rk-legend-ticker">{s.row.ticker}</span>
            <span className="rk-legend-pct">{(s.row.weight * 100).toFixed(1)}%</span>
            {s.row.weight > 0.25 && <span className="rk-flag">&gt;25%</span>}
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
      style={{ width: "100%", display: "block" }}
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
    <div className="rk-sugg-card rk-skel">
      <div className="rk-skel-row">
        <div className="rk-skel-bar" style={{ height: 28, width: 64 }} />
        <div className="rk-skel-bar" style={{ height: 20, width: 48 }} />
        <div className="rk-skel-bar" style={{ height: 20, width: 64, marginLeft: "auto" }} />
      </div>
      <div className="rk-skel-bar" style={{ height: 12, width: "75%", marginBottom: 8 }} />
      <div className="rk-skel-bar" style={{ height: 12, width: "100%", opacity: 0.7 }} />
      <div className="rk-skel-bar" style={{ height: 12, width: "85%", marginTop: 6, opacity: 0.7 }} />
    </div>
  );
}

function SuggestionCard({ suggestion }) {
  const { ticker, company, action, risk_level, sector, rationale } = suggestion;
  const isBuy = action === "Buy";
  const riskColor =
    risk_level === "High" ? ROSE : risk_level === "Medium" ? "#F59E0B" : TEAL;

  return (
    <div className="rk-sugg-card">
      <div className="rk-sugg-tags">
        <span className="rk-tag-ticker">{ticker}</span>
        <span
          className="rk-tag"
          style={{
            background: (isBuy ? TEAL : "#3B82F6") + "22",
            color: isBuy ? "#2DD4BF" : "#60A5FA",
          }}
        >
          {action}
        </span>
        <span
          className="rk-tag rk-tag-risk"
          style={{ background: riskColor + "1f", color: riskColor }}
        >
          {risk_level} risk
        </span>
      </div>
      <p className="rk-sugg-company">
        {company} <span className="rk-sugg-sector">· {sector}</span>
      </p>
      <p className="rk-sugg-rationale">{rationale}</p>
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
    <div className="rk-root">
      <style>{STYLES}</style>
      <Toast message={toast} />

      <div className="rk-shell">
        {/* Header */}
        <header className="rk-header">
          <h1 className="rk-title">
            <span style={{ color: ACCENT }}>Risk</span>ometer
          </h1>
          <p className="rk-subtitle">
            Understand your portfolio's risk relative to the market.
          </p>
        </header>

        {/* Portfolio input */}
        <Card style={{ marginBottom: 22 }}>
          <CardTitle>Portfolio</CardTitle>
          <form onSubmit={addHolding} className="rk-form">
            <input
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              placeholder="Ticker (e.g. NVDA)"
              className="rk-input rk-input-ticker"
              maxLength={6}
              aria-label="Ticker symbol"
            />
            <span style={{ color: "#64748B" }}>×</span>
            <input
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              placeholder="Qty"
              type="number"
              min="1"
              step="1"
              className="rk-input rk-input-qty"
              aria-label="Quantity"
            />
            <button type="submit" className="rk-btn">
              Add
            </button>
            <span className="rk-count">
              {holdings.length}/{MAX_HOLDINGS} stocks
            </span>
          </form>

          {/* Chips */}
          {holdings.length > 0 && (
            <div className="rk-chips">
              {holdings.map((h) => (
                <span key={h.ticker} className="rk-chip">
                  {h.ticker}
                  <span className="rk-chip-qty">× {h.qty}</span>
                  <button
                    onClick={() => removeHolding(h.ticker)}
                    aria-label={`Remove ${h.ticker}`}
                    className="rk-chip-x"
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
          <div className="rk-empty">
            <p className="rk-empty-icon">📊</p>
            <p className="rk-empty-main">Add your stocks to see your risk profile</p>
            <p className="rk-empty-hint">Try NVDA, AAPL, MSFT, TSLA…</p>
          </div>
        )}

        {/* Dashboard */}
        {portfolio && (
          <>
            {/* Hero gauge */}
            <Card className="rk-gauge-card">
              <RiskGauge beta={portfolio.portfolioBeta} />
              <p className="rk-gauge-label">Portfolio beta vs S&amp;P 500</p>
            </Card>

            <div className="rk-grid">
              {/* Beta table */}
              <Card>
                <CardTitle>Portfolio Beta</CardTitle>
                <div className="rk-beta-row">
                  <span className="rk-beta-big">
                    {portfolio.portfolioBeta.toFixed(2)}
                  </span>
                  <span className="rk-beta-meta">
                    weighted avg · ${portfolio.totalValue.toLocaleString()} total
                  </span>
                </div>
                <table className="rk-table">
                  <thead>
                    <tr>
                      <th>Stock</th>
                      <th className="rk-num">Beta</th>
                      <th className="rk-num">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.rows.map((r) => (
                      <tr key={r.ticker}>
                        <td>{r.ticker}</td>
                        <td
                          className="rk-num"
                          style={{
                            fontWeight: 600,
                            color: r.beta > 1.5 ? ROSE : r.beta < 1 ? TEAL : "#E2E8F0",
                          }}
                        >
                          {r.beta.toFixed(2)}
                        </td>
                        <td className="rk-num rk-weight">
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
                      <span className="rk-flag">
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
                      <span className="rk-flag">⚠ &gt;60% one sector</span>
                    ) : null
                  }
                >
                  Sector Exposure
                </CardTitle>
                <SectorBars sectors={portfolio.sectors} />
              </Card>

              {/* Verdict */}
              <Card className="rk-verdict-card">
                <CardTitle>Volatility Verdict</CardTitle>
                <p className="rk-verdict">{verdict}</p>
                <div className="rk-verdict-tag">
                  <span
                    className="rk-dot"
                    style={{
                      background:
                        portfolio.portfolioBeta > 1.5
                          ? ROSE
                          : portfolio.portfolioBeta > 1.1
                            ? "#F59E0B"
                            : TEAL,
                    }}
                  />
                  <span>
                    {portfolio.portfolioBeta > 1.5
                      ? "High volatility"
                      : portfolio.portfolioBeta > 1.1
                        ? "Above-market volatility"
                        : portfolio.portfolioBeta < 0.9
                          ? "Defensive"
                          : "Market-like volatility"}
                  </span>
                </div>
              </Card>
            </div>

            {/* AI suggestions */}
            <Card>
              <div className="rk-sugg-head">
                <div>
                  <h3 className="rk-card-title">AI Stock Suggestions</h3>
                  <p className="rk-sugg-sub">
                    Powered by Claude · based on your beta, sectors and concentration
                  </p>
                </div>
                <button
                  onClick={getSuggestions}
                  disabled={loadingSuggestions}
                  className="rk-btn"
                >
                  {loadingSuggestions
                    ? "Analysing…"
                    : suggestions
                      ? "Refresh"
                      : "Get Suggestions"}
                </button>
              </div>

              {suggestionError && <p className="rk-error">{suggestionError}</p>}

              {loadingSuggestions && (
                <div className="rk-sugg-grid">
                  {[0, 1, 2, 3].map((i) => (
                    <SuggestionSkeleton key={i} />
                  ))}
                </div>
              )}

              {!loadingSuggestions && suggestions && (
                <div className="rk-sugg-grid">
                  {suggestions.map((s) => (
                    <SuggestionCard key={s.ticker} suggestion={s} />
                  ))}
                </div>
              )}

              {!loadingSuggestions && !suggestions && !suggestionError && (
                <p className="rk-sugg-empty">
                  Get AI-powered ideas to balance your portfolio.
                </p>
              )}
            </Card>
          </>
        )}

        <footer className="rk-footer">Mock data · not investment advice</footer>
      </div>
    </div>
  );
}
