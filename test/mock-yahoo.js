/**
 * Mock Yahoo Finance for end-to-end testing.
 * Implements the same endpoints server.js calls, with known prices:
 *   D05.SI (DBS)  → S$61.20
 *   NVDA          → $188.50
 * Run: node test/mock-yahoo.js   (port 3999)
 */
import express from "express";

const app = express();
const PORT = 3999;

const DB = {
  NVDA: {
    longName: "NVIDIA Corporation",
    price: 188.5,
    currency: "USD",
    beta: 2.12,
    sector: "Technology",
  },
  "D05.SI": {
    longName: "DBS Group Holdings Ltd",
    price: 61.2,
    currency: "SGD",
    beta: 1.08,
    sector: "Financial Services",
  },
  AAPL: {
    longName: "Apple Inc.",
    price: 245.3,
    currency: "USD",
    beta: 1.18,
    sector: "Technology",
  },
};

let crumbIssued = false;

// fc.yahoo.com stand-in: 404 but sets the session cookie (Yahoo's real behavior)
app.get("/fc", (_req, res) => {
  res.setHeader("Set-Cookie", "A3=mock-session-cookie; Path=/");
  res.status(404).send("not found");
});

app.get("/v1/test/getcrumb", (req, res) => {
  // Set MOCK_CRUMB_429=1 to simulate Yahoo rate-limiting the crumb endpoint
  // (the user's real situation) while the chart endpoint still works.
  if (process.env.MOCK_CRUMB_429) return res.status(429).send("");
  if (!req.headers.cookie?.includes("A3=mock-session-cookie")) {
    return res.status(401).send("");
  }
  crumbIssued = true;
  res.type("text/plain").send("mockcrumb1");
});

app.get("/v1/finance/search", (req, res) => {
  const q = (req.query.q || "").toUpperCase();
  const quotes = Object.entries(DB)
    .filter(([sym, d]) => sym.includes(q) || d.longName.toUpperCase().includes(q))
    .map(([sym, d]) => ({
      symbol: sym,
      quoteType: "EQUITY",
      longname: d.longName,
      sectorDisp: d.sector,
      exchDisp: sym.endsWith(".SI") ? "Singapore" : "NASDAQ",
    }));
  res.json({ quotes });
});

app.get("/v10/finance/quoteSummary/:symbol", (req, res) => {
  if (req.query.crumb !== "mockcrumb1") {
    return res.status(401).json({ error: "missing crumb" });
  }
  const d = DB[req.params.symbol.toUpperCase()];
  if (!d) return res.status(404).json({ quoteSummary: { result: null } });
  res.json({
    quoteSummary: {
      result: [
        {
          price: {
            regularMarketPrice: { raw: d.price },
            longName: d.longName,
            currency: d.currency,
          },
          defaultKeyStatistics: { beta: { raw: d.beta } },
          assetProfile: { sector: d.sector },
        },
      ],
    },
  });
});

// Deterministic synthetic price history so computeBeta has data to regress.
// ^GSPC is the market; each stock moves as (knownBeta * market move + noise),
// so the regression should recover ~knownBeta.
const BETA_BY_SYMBOL = { NVDA: 2.12, "D05.SI": 1.08, AAPL: 1.18, "^GSPC": 1 };
function history(symbol, days = 250) {
  const beta = symbol === "^GSPC" ? 1 : BETA_BY_SYMBOL[symbol] ?? 1;
  const ts = [];
  const close = [];
  let mkt = 100;
  let px = 100;
  const start = Math.floor(Date.now() / 1000) - days * 86400;
  // Seeded pseudo-random so the test is deterministic
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5);
  for (let i = 0; i < days; i++) {
    const mktRet = rnd() * 0.02; // market daily return
    mkt *= 1 + mktRet;
    px *= 1 + beta * mktRet; // stock tracks beta×market exactly (clean signal)
    ts.push(start + i * 86400);
    close.push(symbol === "^GSPC" ? mkt : px);
  }
  return { ts, close };
}

app.get("/v8/finance/chart/:symbol", (req, res) => {
  const sym = decodeURIComponent(req.params.symbol).toUpperCase();
  const isIndex = sym === "^GSPC";
  const d = DB[sym];
  if (!d && !isIndex) return res.status(404).json({ chart: { result: null } });

  // 1y history request → return timestamp + close arrays for beta computation
  if (req.query.range === "1y") {
    const { ts, close } = history(sym);
    return res.json({
      chart: {
        result: [
          {
            meta: { regularMarketPrice: close[close.length - 1], currency: d?.currency || "USD" },
            timestamp: ts,
            indicators: { quote: [{ close }] },
          },
        ],
      },
    });
  }

  // 1d request → just the live meta
  res.json({
    chart: {
      result: [
        { meta: { regularMarketPrice: d.price, currency: d.currency, longName: d.longName } },
      ],
    },
  });
});

app.listen(PORT, () => console.log(`Mock Yahoo on http://localhost:${PORT}`));
