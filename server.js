/**
 * Riskometer market-data proxy
 *
 * Uses the standard Yahoo Finance cookie + crumb authentication flow so
 * requests look like a real browser session — prevents the 403/429 errors
 * that happen when calling Yahoo without credentials.
 *
 * One quoteSummary call per stock returns price, beta AND sector,
 * so there's no need to download 250 days of history to compute beta.
 *
 * Run:  node server.js          (default port 3001)
 */

import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());

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

  console.log("Starting Yahoo Finance session…");

  // Step 1: hit fc.yahoo.com to receive the initial auth cookies
  const cookieRes = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": UA },
    redirect: "follow",
  });

  // Node 18+ exposes headers.getSetCookie(); fall back to single header
  const rawCookies =
    typeof cookieRes.headers.getSetCookie === "function"
      ? cookieRes.headers.getSetCookie()
      : [cookieRes.headers.get("set-cookie") || ""];

  const cookieStr = rawCookies
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");

  // Step 2: exchange cookies for a crumb
  const crumbRes = await fetch(
    "https://query1.finance.yahoo.com/v1/test/getcrumb",
    { headers: { "User-Agent": UA, Cookie: cookieStr } }
  );

  if (!crumbRes.ok) throw new Error(`Could not get crumb: ${crumbRes.status}`);
  const crumb = await crumbRes.text();
  if (!crumb || crumb.startsWith("{")) throw new Error("Unexpected crumb response");

  session = { cookieStr, crumb, expiry: Date.now() + 25 * MIN };
  console.log(`Yahoo session ready (crumb: ${crumb.slice(0, 6)}…)`);
  return session;
}

// Authenticated fetch with auto-refresh on 401/403 and one retry on 429
async function yfGet(url) {
  let { cookieStr, crumb } = await initSession();
  const sep = url.includes("?") ? "&" : "?";
  const makeUrl = (c) => `${url}${sep}crumb=${encodeURIComponent(c)}`;

  let res = await fetch(makeUrl(crumb), {
    headers: { "User-Agent": UA, Cookie: cookieStr },
  });

  if (res.status === 401 || res.status === 403) {
    // Session expired — re-auth and retry once
    ({ cookieStr, crumb } = await initSession(true));
    res = await fetch(makeUrl(crumb), {
      headers: { "User-Agent": UA, Cookie: cookieStr },
    });
  } else if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 4000));
    res = await fetch(makeUrl(crumb), {
      headers: { "User-Agent": UA, Cookie: cookieStr },
    });
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
// Yahoo Finance helpers
// ---------------------------------------------------------------------------

function searchYahoo(q) {
  return cached(`search:${q.toUpperCase()}`, 5 * MIN, () =>
    yfGet(
      `https://query1.finance.yahoo.com/v1/finance/search` +
        `?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`
    ).then((d) =>
      (d.quotes || []).filter((r) => r.quoteType === "EQUITY" && r.symbol)
    )
  );
}

// quoteSummary with price + beta + sector — one request per stock
function quoteSummary(symbol) {
  return cached(`summary:${symbol}`, 8 * MIN, () =>
    yfGet(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary` +
        `/${encodeURIComponent(symbol)}` +
        `?modules=price%2CdefaultKeyStatistics%2CassetProfile`
    )
  );
}

const SECTOR_MAP = {
  "Financial Services": "Financials",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Basic Materials": "Materials",
};

async function enrichSymbol(symbol) {
  const data = await quoteSummary(symbol);
  const r = data?.quoteSummary?.result?.[0];
  if (!r) return null;

  const price = r.price?.regularMarketPrice?.raw;
  if (price == null) return null;

  const sector =
    SECTOR_MAP[r.assetProfile?.sector] || r.assetProfile?.sector || "Other";
  const exchange = symbol.endsWith(".SI") ? "SGX" : "US";

  return {
    symbol,
    name: r.price?.longName || r.price?.shortName || symbol,
    price,
    beta: r.defaultKeyStatistics?.beta?.raw ?? 1.0,
    sector,
    exchange,
    currency: r.price?.currency || (exchange === "SGX" ? "SGD" : "USD"),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Instant health check — no Yahoo call, used by the front-end LIVE detection
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Symbol search — returns up to 8 enriched results
app.get("/api/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  try {
    const hits = (await searchYahoo(q)).slice(0, 8);
    // Fetch prices for the top hits in parallel; skip any that fail
    const enriched = await Promise.all(
      hits.map((h) => enrichSymbol(h.symbol).catch(() => null))
    );
    res.json(enriched.filter(Boolean));
  } catch (err) {
    console.error("search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Single quote — includes live price, beta, sector
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
// Startup — warm the session before accepting requests
// ---------------------------------------------------------------------------
initSession()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`Riskometer proxy ready on http://localhost:${PORT}`)
    );
  })
  .catch((err) => {
    console.error("Could not start Yahoo session:", err.message);
    console.log("Starting anyway — session will retry on first request.");
    app.listen(PORT, () =>
      console.log(`Riskometer proxy on http://localhost:${PORT} (session pending)`)
    );
  });
