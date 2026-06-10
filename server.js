/**
 * Riskometer market-data proxy
 *
 * Wraps Yahoo Finance (yahoo-finance2) so the browser never touches an
 * external API directly and no key is exposed in the front-end bundle.
 *
 * Covers all US-listed stocks (NYSE / NASDAQ) and SGX stocks (.SI suffix).
 *
 * Run:  node server.js          (default port 3001)
 *       PORT=4000 node server.js
 */

import express from "express";
import cors from "cors";
import yahooFinance from "yahoo-finance2";

yahooFinance.setGlobalConfig({ validation: { logErrors: false } });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// ---------------------------------------------------------------------------
// GET /api/search?q=<query>
// Returns up to 8 matching quotes (stocks only) with live prices + beta.
// ---------------------------------------------------------------------------
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);

  try {
    const searchRes = await yahooFinance.search(q, { newsCount: 0 });
    const hits = (searchRes.quotes || [])
      .filter((r) => r.quoteType === "EQUITY" && r.symbol)
      .slice(0, 8);

    if (hits.length === 0) return res.json([]);

    // Bulk-fetch quotes + key stats in parallel
    const enriched = await Promise.all(
      hits.map((h) => enrichSymbol(h.symbol).catch(() => null))
    );

    res.json(enriched.filter(Boolean));
  } catch (err) {
    console.error("search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/quote/:symbol
// Returns a single enriched quote (used when user types a ticker directly).
// ---------------------------------------------------------------------------
app.get("/api/quote/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const quote = await enrichSymbol(symbol);
    if (!quote) return res.status(404).json({ error: "Symbol not found" });
    res.json(quote);
  } catch (err) {
    console.error("quote error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function enrichSymbol(symbol) {
  // Fetch price quote and key stats (beta) in parallel
  const [q, summary] = await Promise.all([
    yahooFinance.quote(symbol).catch(() => null),
    yahooFinance
      .quoteSummary(symbol, { modules: ["defaultKeyStatistics", "assetProfile"] })
      .catch(() => null),
  ]);

  if (!q || !q.regularMarketPrice) return null;

  const beta = summary?.defaultKeyStatistics?.beta ?? 1.0;
  const sector = summary?.assetProfile?.sector ?? inferSector(q.sector);
  const exchange = symbol.endsWith(".SI") ? "SGX" : "US";
  const currency = q.currency || (exchange === "SGX" ? "SGD" : "USD");

  return {
    symbol: q.symbol,
    name: q.longName || q.shortName || q.symbol,
    price: q.regularMarketPrice,
    beta: typeof beta === "number" ? parseFloat(beta.toFixed(2)) : 1.0,
    sector: sector || "Other",
    exchange,
    currency,
  };
}

function inferSector(raw) {
  if (!raw) return "Other";
  const map = {
    Technology: "Technology",
    "Financial Services": "Financials",
    Healthcare: "Healthcare",
    "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Defensive": "Consumer Staples",
    Industrials: "Industrials",
    "Communication Services": "Communication Services",
    Energy: "Energy",
    "Real Estate": "Real Estate",
    Utilities: "Utilities",
    "Basic Materials": "Materials",
  };
  return map[raw] || raw;
}

// ---------------------------------------------------------------------------
app.listen(PORT, () =>
  console.log(`Riskometer proxy listening on http://localhost:${PORT}`)
);
