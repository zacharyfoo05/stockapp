/**
 * End-to-end browser test: drives the real UI in Chromium.
 * Requires: mock Yahoo (3999), proxy (3001), vite (5173) all running.
 */
import { chromium } from "playwright";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && console.log("  [console.error]", m.text()));
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });

// 1. LIVE badge appears
await sleep(800);
const badge = await page.locator("text=● LIVE").count();
check("LIVE badge visible", badge === 1);

// 2. Type NVDA → dropdown shows NVIDIA with live data
await page.fill('input[aria-label="Search stock symbol"]', "NVDA");
await sleep(900); // debounce + fetch
const ddText = await page.locator(".rk-dropdown").textContent().catch(() => "");
check("dropdown shows NVIDIA", ddText.includes("NVIDIA"), ddText.slice(0, 80));

// 3. Select it, add 10 shares
await page.keyboard.press("Enter"); // picks highlighted result
await page.fill('input[aria-label="Quantity"]', "10");
await page.click('button:has-text("Add")');
await sleep(1200);

// 4. Portfolio shows the LIVE price (188.5 × 10 = 1,885) and live beta 2.12
const body = await page.textContent("body");
check("live NVDA beta 2.12 in table", body.includes("2.12"));
check("live total $1,885 (188.50 × 10)", body.includes("1,885"), "if FAIL, stale price was used");

// 5. Add DBS via bare code "D05" — exercises SGX fallback + currency convert
await page.fill('input[aria-label="Search stock symbol"]', "DBS");
await sleep(900);
const dd2 = await page.locator(".rk-dropdown").textContent().catch(() => "");
check("dropdown shows DBS via name search", dd2.includes("DBS Group"), dd2.slice(0, 80));
await page.keyboard.press("Enter");
await page.fill('input[aria-label="Quantity"]', "5");
await page.click('button:has-text("Add")');
await sleep(1200);

const body2 = await page.textContent("body");
check("D05.SI holding added", body2.includes("D05.SI"));
check("SGX FX note shown", body2.includes("1 SGD"));
// 61.2 SGD * 0.74 * 5 = 226.44 → total 1885 + 226 = 2111
check("DBS live price in total (US$2,111)", body2.includes("2,111"), "stale 45.0 would give 2,051");

// 6. Gauge + verdict render
check("risk gauge rendered", (await page.locator('svg[role="img"]').count()) === 1);
check("volatility verdict shown", body2.includes("volatile") || body2.includes("volatility"));

await page.screenshot({ path: "/tmp/riskometer-e2e.png", fullPage: true });
await browser.close();

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
