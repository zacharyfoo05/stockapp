/**
 * Riskometer market-data proxy
 *
 * Calls Yahoo Finance's public HTTP endpoints directly with fetch —
 * no third-party finance library (the yahoo-finance2 package ships
 * broken/incompatible builds depending on version).
 *
 * Covers all US-listed stocks (NYSE / NASDAQ) and SGX stocks (.SI suffix).
 * Beta is computed from 1 year of daily returns regressed against ^GSPC.
 *
 * Run:  node server.js          (default port 3001)
 *       PORT=4000 node server.js
 */

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

const YF_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json",
};

// Fetch with automatic retry on 429 (rate-limit) — waits 2 s then 5 s.
async function yfJson(url) {
  const delays = [2000, 5000];
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: YF_HEADERS });
    if (r.ok) return r.json();
    if (r.status === 429 && attempt < delays.length) {
      await new Promise((res) => setTimeout(res, delays[attempt]));
      continue;
    }
    throw new Error(`Yahoo responded ${r.status}`);
  }
}

// Simple in-memory cache with TTL
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.p;
  const p = fn().catch((err) => {
    cache.delete(key); // don't cache failures
    throw err;
  });
  cache.set(key, { t: Date.now(), p });
  return p;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

// ---------------------------------------------------------------------------
// Yahoo endpoint wrappers
// ---------------------------------------------------------------------------

function searchYahoo(q) {
  return cached(`search:${q.toUpperCase()}`, 10 * MIN, async () => {
    const url =
      `https://query1.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
    const data = await yfJson(url);
    return (data.quotes || []).filter(
      (r) => r.quoteType === "EQUITY" && r.symbol
    );
  });
}

// Price, currency and (sometimes) long name come from the chart meta —
// this endpoint needs no auth crumb, unlike v7/quote.
function chartMeta(symbol) {
  return cached(`meta:${symbol}`, 5 * MIN, async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const data = await yfJson(url);
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice == null) return null;
    return meta;
  });
}

// Daily closes for the past year, as { dayTimestamp -> close }
function dailyCloses(symbol) {
  return cached(`closes:${symbol}`, 12 * HOUR, async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
    const data = await yfJson(url);
    const result = data?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const map = new Map();
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null) {
        const day = new Date(ts[i] * 1000).toISOString().slice(0, 10);
        map.set(day, closes[i]);
      }
    }
    return map;
  });
}

// Beta = cov(stock returns, S&P 500 returns) / var(S&P 500 returns)
async function computeBeta(symbol) {
  try {
    const [stock, index] = await Promise.all([
      dailyCloses(symbol),
      dailyCloses("^GSPC"),
    ]);
    const days = [...stock.keys()].filter((d) => index.has(d)).sort();
    if (days.length < 60) return null; // not enough overlap to be meaningful

    const sR = [];
    const iR = [];
    for (let i = 1; i < days.length; i++) {
      const s0 = stock.get(days[i - 1]);
      const s1 = stock.get(days[i]);
      const x0 = index.get(days[i - 1]);
      const x1 = index.get(days[i]);
      sR.push(s1 / s0 - 1);
      iR.push(x1 / x0 - 1);
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const mS = mean(sR);
    const mI = mean(iR);
    let cov = 0;
    let varI = 0;
    for (let i = 0; i < sR.length; i++) {
      cov += (sR[i] - mS) * (iR[i] - mI);
      varI += (iR[i] - mI) ** 2;
    }
    if (varI === 0) return null;
    return parseFloat((cov / varI).toFixed(2));
  } catch {
    return null;
  }
}

const SECTOR_NORMALISE = {
  "Financial Services": "Financials",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Basic Materials": "Materials",
};

function normaliseSector(raw) {
  if (!raw) return "Other";
  return SECTOR_NORMALISE[raw] || raw;
}

// Full quote used by the front-end. Name/sector are best-effort via search.
async function enrichSymbol(symbol, { withBeta = true } = {}) {
  const meta = await chartMeta(symbol);
  if (!meta) return null;

  let name = meta.longName || meta.shortName || symbol;
  let sector = "Other";
  try {
    const hits = await searchYahoo(symbol);
    const exact = hits.find((h) => h.symbol === symbol) || hits[0];
    if (exact) {
      name = exact.longname || exact.shortname || name;
      sector = normaliseSector(exact.sectorDisp || exact.sector);
    }
  } catch {
    // search is decorative — price still works without it
  }

  const beta = withBeta ? await computeBeta(symbol) : null;
  const exchange = symbol.endsWith(".SI") ? "SGX" : "US";

  return {
    symbol,
    name,
    price: meta.regularMarketPrice,
    beta: beta ?? 1.0,
    sector,
    exchange,
    currency: meta.currency || (exchange === "SGX" ? "SGD" : "USD"),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/health — instant liveness check, never hits Yahoo
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// GET /api/search?q=<query> — up to 8 matches with live prices
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  try {
    const hits = (await searchYahoo(q)).slice(0, 8);
    // Skip beta in search results — only the dropdown price is shown there,
    // and the full quote (with beta) is fetched again when the user adds it.
    const enriched = await Promise.all(
      hits.map((h) => enrichSymbol(h.symbol, { withBeta: false }).catch(() => null))
    );
    res.json(enriched.filter(Boolean));
  } catch (err) {
    console.error("search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quote/:symbol — single enriched quote incl. computed beta
app.get("/api/quote/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    let quote = await enrichSymbol(symbol);
    if (!quote && !symbol.includes(".")) {
      quote = await enrichSymbol(`${symbol}.SI`); // SGX fallback for bare codes
    }
    if (!quote) return res.status(404).json({ error: "Symbol not found" });
    res.json(quote);
  } catch (err) {
    console.error("quote error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () =>
  console.log(`Riskometer proxy listening on http://localhost:${PORT}`)
);
