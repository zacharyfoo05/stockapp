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

app.get("/v8/finance/chart/:symbol", (req, res) => {
  const d = DB[req.params.symbol.toUpperCase()];
  if (!d) return res.status(404).json({ chart: { result: null } });
  res.json({
    chart: {
      result: [
        { meta: { regularMarketPrice: d.price, currency: d.currency, longName: d.longName } },
      ],
    },
  });
});

app.listen(PORT, () => console.log(`Mock Yahoo on http://localhost:${PORT}`));
