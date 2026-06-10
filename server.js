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

// Fallback quote via the public chart endpoint (no crumb needed).
// Beta/sector are best-effort from the search index.
async function quoteViaChart(symbol) {
  const data = await yfGet(
    `${Q1}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
    { withCrumb: false }
  );
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) return null;

  let name = meta.longName || meta.shortName || symbol;
  let sector = "Other";
  try {
    const hits = await searchYahoo(symbol);
    const exact = hits.find((h) => h.symbol === symbol) || hits[0];
    if (exact) {
      name = exact.name;
      sector = exact.sector;
    }
  } catch {
    // decorative
  }
  return {
    symbol,
    name,
    price: meta.regularMarketPrice,
    beta: 1.0,
    sector,
    exchange: exchangeOf(symbol),
    currency: meta.currency || (symbol.endsWith(".SI") ? "SGD" : "USD"),
  };
}

function getQuote(symbol) {
  return cached(`quote:${symbol}`, 5 * MIN, async () => {
    try {
      const q = await quoteViaSummary(symbol);
      if (q) return q;
    } catch (err) {
      console.log(`quoteSummary failed for ${symbol} (${err.message}) — trying chart`);
    }
    return quoteViaChart(symbol);
  });
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

app.listen(PORT, () => {
  console.log(`Riskometer proxy listening on http://localhost:${PORT}`);
  initSession().catch((err) =>
    console.log(`Yahoo session pending (${err.message}) — will retry on demand`)
  );
});
