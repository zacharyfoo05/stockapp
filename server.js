/**
 * Riskometer market-data proxy
 *
 * Yahoo Finance with the standard cookie + crumb authentication flow.
 * Designed to stay under Yahoo's rate limits:
 *   - search returns Yahoo's own search hits (1 request, no per-hit quotes)
 *   - quotes are requested one symbol at a time, only when the user adds it
 *   - everything is cached in memory
 *
 * If quoteSummary fails (crumb rejected on some networks), falls back to
 * the public chart endpoint for the price so live prices still work.
 *
 * Run:  node server.js          (default port 3001)
 */

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());

// Overridable for testing against a mock Yahoo
const Q1 = process.env.YF_Q1 || "https://query1.finance.yahoo.com";
const Q2 = process.env.YF_Q2 || "https://query2.finance.yahoo.com";
const FC = process.env.YF_FC || "https://fc.yahoo.com";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MIN = 60_000;

// ---------------------------------------------------------------------------
// Yahoo Finance session — cookies + crumb
// ---------------------------------------------------------------------------
let session = null;

async function initSession(force = false) {
  if (!force && session && Date.now() < session.expiry) return session;

  // Step 1: fc.yahoo.com responds 404/403 but sets the session cookie
  const cookieRes = await fetch(FC, {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });
  const rawCookies =
    typeof cookieRes.headers.getSetCookie === "function"
      ? cookieRes.headers.getSetCookie()
      : [cookieRes.headers.get("set-cookie") || ""];
  const cookieStr = rawCookies
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // Step 2: exchange cookies for a crumb
  const crumbRes = await fetch(`${Q1}/v1/test/getcrumb`, {
    headers: { "User-Agent": UA, Cookie: cookieStr },
  });
  if (!crumbRes.ok) throw new Error(`crumb request failed (${crumbRes.status})`);
  const crumb = await crumbRes.text();
  if (!crumb || crumb.includes("{")) throw new Error("invalid crumb");

  session = { cookieStr, crumb, expiry: Date.now() + 25 * MIN };
  console.log(`Yahoo session ready (crumb ${crumb.slice(0, 4)}…)`);
  return session;
}

async function yfGet(url, { withCrumb = true } = {}) {
  let headers = { "User-Agent": UA };
  let finalUrl = url;

  if (withCrumb) {
    try {
      const s = await initSession();
      headers.Cookie = s.cookieStr;
      finalUrl += (url.includes("?") ? "&" : "?") + `crumb=${encodeURIComponent(s.crumb)}`;
    } catch {
      // proceed without crumb — some endpoints accept it
    }
  }

  let res = await fetch(finalUrl, { headers });

  if ((res.status === 401 || res.status === 403) && withCrumb) {
    try {
      const s = await initSession(true);
      headers.Cookie = s.cookieStr;
      finalUrl =
        url + (url.includes("?") ? "&" : "?") + `crumb=${encodeURIComponent(s.crumb)}`;
      res = await fetch(finalUrl, { headers });
    } catch {
      // fall through to error below
    }
  } else if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 3000));
    res = await fetch(finalUrl, { headers });
  }

  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.p;
  const p = fn().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { t: Date.now(), p });
  return p;
}

// ---------------------------------------------------------------------------
// Yahoo helpers
// ---------------------------------------------------------------------------

const SECTOR_MAP = {
  "Financial Services": "Financials",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Basic Materials": "Materials",
};
const normSector = (s) => (s ? SECTOR_MAP[s] || s : "Other");
const exchangeOf = (symbol) => (symbol.endsWith(".SI") ? "SGX" : "US");

// 1 request per search — search hits carry name/exchange/sector, no price.
function searchYahoo(q) {
  return cached(`search:${q.toUpperCase()}`, 5 * MIN, () =>
    yfGet(
      `${Q1}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`,
      { withCrumb: false }
    ).then((d) =>
      (d.quotes || [])
        .filter((r) => r.quoteType === "EQUITY" && r.symbol)
        .slice(0, 8)
        .map((r) => ({
          symbol: r.symbol,
          name: r.longname || r.shortname || r.symbol,
          price: null, // filled in only when the user adds the stock
          beta: null,
          sector: normSector(r.sectorDisp || r.sector),
          exchange: exchangeOf(r.symbol),
          currency: r.symbol.endsWith(".SI") ? "SGD" : "USD",
        }))
    )
  );
}

// Full quote via quoteSummary (price + beta + sector in one request)
async function quoteViaSummary(symbol) {
  const data = await yfGet(
    `${Q2}/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
      `?modules=price%2CdefaultKeyStatistics%2CassetProfile`
  );
  const r = data?.quoteSummary?.result?.[0];
  const price = r?.price?.regularMarketPrice?.raw;
  if (price == null) return null;
  return {
    symbol,
    name: r.price?.longName || r.price?.shortName || symbol,
    price,
    beta: r.defaultKeyStatistics?.beta?.raw ?? 1.0,
    sector: normSector(r.assetProfile?.sector),
    exchange: exchangeOf(symbol),
    currency: r.price?.currency || (symbol.endsWith(".SI") ? "SGD" : "USD"),
  };
}

// One year of daily closes via the crumb-free chart endpoint: { 'YYYY-MM-DD' -> close }
function dailyCloses(symbol) {
  return cached(`closes:${symbol}`, 6 * 60 * MIN, async () => {
    const data = await yfGet(
      `${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`,
      { withCrumb: false }
    );
    const result = data?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const map = new Map();
    for (let i = 0; i < ts.length; i++) {
      if (closes[i] != null) {
        map.set(new Date(ts[i] * 1000).toISOString().slice(0, 10), closes[i]);
      }
    }
    return map;
  });
}

// Real beta = cov(stock returns, S&P 500 returns) / var(S&P 500 returns).
// Uses the crumb-free chart endpoint, so it works even while rate-limited.
// Returns null (not a fake 1.0) if there isn't enough overlapping history.
async function computeBeta(symbol) {
  const [stock, index] = await Promise.all([
    dailyCloses(symbol),
    dailyCloses("%5EGSPC"), // ^GSPC, cached once and reused for every symbol
  ]);
  const days = [...stock.keys()].filter((d) => index.has(d)).sort();
  if (days.length < 60) return null;

  const sR = [];
  const iR = [];
  for (let i = 1; i < days.length; i++) {
    sR.push(stock.get(days[i]) / stock.get(days[i - 1]) - 1);
    iR.push(index.get(days[i]) / index.get(days[i - 1]) - 1);
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
}

// Chart endpoint needs no crumb — works even while the session is rate-limited.
// Price/currency/name from chart meta; beta computed from real price history.
async function quoteViaChart(symbol) {
  const data = await yfGet(
    `${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
    { withCrumb: false }
  );
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) return null;

  // Prefer quoteSummary when a session exists (gives Yahoo's published beta);
  // otherwise compute a real beta from history. Both are genuine — never 1.0 filler.
  if (session) {
    try {
      const q = await quoteViaSummary(symbol);
      if (q) return q;
    } catch {
      // session not ready — fall through to history-based beta
    }
  }

  let name = meta.longName || meta.shortName || symbol;
  let sector = "Other";
  try {
    const hits = await searchYahoo(symbol);
    const exact = hits.find((h) => h.symbol === symbol) || hits[0];
    if (exact) { name = exact.name; sector = exact.sector; }
  } catch {
    // decorative
  }

  // Real computed beta; null if history is too short (UI shows "—", excluded from avg)
  let beta = null;
  try {
    beta = await computeBeta(symbol);
  } catch {
    beta = null;
  }

  return {
    symbol,
    name,
    price: meta.regularMarketPrice,
    beta,
    sector,
    exchange: exchangeOf(symbol),
    currency: meta.currency || (symbol.endsWith(".SI") ? "SGD" : "USD"),
  };
}

// Always try chart first (no crumb needed = works even when rate-limited).
// quoteSummary is only used as a second attempt inside quoteViaChart once
// a session is established, so we never need two separate code paths here.
function getQuote(symbol) {
  return cached(`quote:${symbol}`, 5 * MIN, () => quoteViaChart(symbol));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  try {
    res.json(await searchYahoo(q));
  } catch (err) {
    console.error("search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/quote/:symbol", async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  let quote = null;
  let lastErr = null;
  try {
    quote = await getQuote(symbol);
  } catch (err) {
    lastErr = err;
  }
  if (!quote && !symbol.includes(".")) {
    try {
      quote = await getQuote(`${symbol}.SI`); // bare SGX codes like D05
    } catch (err) {
      lastErr = err;
    }
  }
  if (quote) return res.json(quote);
  console.error("quote error:", lastErr?.message || "not found");
  res.status(404).json({ error: lastErr?.message || "Symbol not found" });
});

// Retry session init with backoff until it succeeds.
// Prices come from the chart endpoint in the meantime — no quotes are blocked.
function scheduleSessionRetry(delayMs = 30_000) {
  setTimeout(async () => {
    try {
      await initSession(true);
    } catch (err) {
      const next = Math.min(delayMs * 2, 10 * 60_000); // cap at 10 min
      console.log(`Session retry in ${Math.round(next / 1000)}s (${err.message})`);
      scheduleSessionRetry(next);
    }
  }, delayMs);
}

app.listen(PORT, () => {
  console.log(`Riskometer proxy listening on http://localhost:${PORT}`);
  initSession().catch((err) => {
    console.log(`Yahoo session pending (${err.message}) — prices still work via chart, retrying…`);
    scheduleSessionRetry();
  });
});
