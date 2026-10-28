// Browser smoke test: opens the built app, creates a throwaway account, clicks through the main windows and fails on
// any uncaught page error or console error. CI runs it against a fresh production build (see .github/workflows/ci.yml).
// Run it yourself:  PW_PATH=/path/to/node_modules/playwright SMOKE_URL=http://localhost:8090 node tools/smoke/smoke.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const URL_ = process.env.SMOKE_URL || "http://localhost:8090";
const USER = process.env.SMOKE_USER || "smoke";
const PASS = process.env.SMOKE_PASS || "Smoke-test-only-1";
// Windows to open from the sidebar (matched by visible text). Missing ones are reported, not fatal, so renames don't break CI.
const WINDOWS = ["Today", "Notes", "Calendar", "Work tools", "Playtests"];
// Console noise that is expected in a bare test environment (no Ollama, no internet-only services, no favicon).
const IGNORE = [/favicon/i, /Failed to load resource/i, /ERR_CONNECTION/i, /ERR_NAME_NOT_RESOLVED/i, /net::ERR/i, /ollama/i, /WebSocket/i];

const problems = [];
const notes = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!IGNORE.some((r) => r.test(t))) problems.push(`console error: ${t.slice(0, 300)}`);
});

async function step(name, fn) {
  try { await fn(); notes.push(`ok   ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); notes.push(`FAIL ${name}`); }
}

await step("home page loads", async () => {
  const r = await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The sign-in page is served with 401 before the first login; anything else that isn't OK is a real failure.
  if (!r || !(r.ok() || r.status() === 401)) throw new Error(`status ${r?.status()}`);
});
await step("create the first account", async () => {
  const create = page.getByRole("button", { name: /create account/i });
  if (await create.count()) {
    const boxes = page.locator("input");
    await boxes.nth(0).fill(USER);
    await boxes.nth(1).fill(PASS);
    await boxes.nth(2).fill(PASS);
    await create.click();
  } else {
    const signIn = page.getByRole("button", { name: /sign in/i });
    if (await signIn.count()) {
      const boxes = page.locator("input");
      await boxes.nth(0).fill(USER);
      await boxes.nth(1).fill(PASS);
      await signIn.click();
    }
  }
  await page.locator("main").first().waitFor({ timeout: 45000 });
});
await page.waitForTimeout(3000);
// Some entries live under the sidebar's "More" group.
await step("expand the sidebar More group", async () => {
  const more = page.locator(".sidebar-item", { hasText: /^\s*More\s*$/i }).first();
  if (await more.count()) await more.click({ timeout: 8000 });
});
for (const label of WINDOWS) {
  await step(`open "${label}"`, async () => {
    const item = page.locator(".sidebar-item", { hasText: new RegExp(`^\\s*${label}\\s*$`, "i") }).first();
    if (!(await item.count())) throw new Error("no such sidebar item");
    await item.click({ timeout: 8000 });
    await page.waitForTimeout(1500);
  });
}

// ---- Documents window: real PDF and spreadsheet files through the built-in viewers ----
function makePdf(texts) {
  const objs = [];
  const n = texts.length;
  const font = 3 + n * 2;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${texts.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`;
  texts.forEach((t, i) => {
    const id = 3 + i * 2;
    objs[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${id + 1} 0 R >>`;
    const stream = `BT /F1 36 Tf 72 700 Td (${t}) Tj ET`;
    objs[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n"; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
async function openDocuments() {
  const item = page.locator(".sidebar-item", { hasText: /^\s*Documents\s*$/i }).first();
  if (!(await item.count())) throw new Error("no Documents sidebar item");
  await item.click({ timeout: 8000 });
  await page.getByTestId("doc-input").waitFor({ state: "attached", timeout: 10000 });
}
async function backToDocuments() {
  const back = page.getByRole("button", { name: /^\s*Back\s*$/ }).first();
  if (await back.count()) await back.click();
  await page.getByTestId("doc-input").waitFor({ state: "attached", timeout: 10000 });
}
await step("Documents: open a PDF, see its pages and text", async () => {
  await openDocuments();
  await page.getByTestId("doc-input").setInputFiles({ name: "smoke.pdf", mimeType: "application/pdf", buffer: makePdf(["Hello Pixel Pals viewer", "Second page marker"]) });
  await page.locator('canvas[aria-label="Page 1"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".pp-textlayer")].some((e) => /Hello Pixel Pals/.test(e.textContent || "")), null, { timeout: 30000 });
  const ink = await page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Page 1"]');
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) dark++;
    return dark;
  });
  if (ink < 50) throw new Error(`page 1 canvas looks blank (${ink} dark pixels)`);
  const total = await page.getByText(/^of 2$/).count();
  if (!total) throw new Error("page count not shown");
});
await step("Documents: search a PDF and jump to the match", async () => {
  await page.getByRole("button", { name: "Search in document" }).click();
  await page.getByLabel("Search the document").fill("marker");
  await page.getByText(/1 of 1/).first().waitFor({ timeout: 20000 });
  await page.locator('canvas[aria-label="Page 2"]').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".pp-hit")].some((e) => /marker/i.test(e.textContent || "")), null, { timeout: 20000 });
});
await step("Documents: zoom, thumbnails and fit controls work", async () => {
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Page thumbnails" }).click();
  await page.getByRole("button", { name: "Go to page 2" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Fit page" }).click();
  await page.getByRole("button", { name: "Fit width" }).click();
});
await step("Documents: a PDF that is not a PDF gives a plain message", async () => {
  await backToDocuments();
  await page.getByTestId("doc-input").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf at all") });
  await page.getByRole("alert").filter({ hasText: /readable PDF|Couldn't open/ }).waitFor({ timeout: 20000 });
});
await step("Documents: open a CSV as a grid", async () => {
  await backToDocuments();
  await page.getByTestId("doc-input").setInputFiles({ name: "parts.csv", mimeType: "text/csv", buffer: Buffer.from("name,qty\nBolts,10\nNuts,7\n") });
  await page.locator('[data-cell="B2"]').waitFor({ timeout: 30000 });
  const t = (await page.locator('[data-cell="B2"]').textContent())?.trim();
  if (t !== "10") throw new Error(`B2 shows ${JSON.stringify(t)}`);
  await page.getByLabel("Search the sheet").fill("nuts");
  await page.getByText(/1 of 1/).first().waitFor({ timeout: 10000 });
  await page.getByLabel("Go to cell").fill("B3");
  await page.getByLabel("Go to cell").press("Enter");
  await page.locator('[data-cell="B3"][aria-selected="true"]').waitFor({ timeout: 10000 });
});
await step("Documents: open an .xlsx in the worker (sheets, merges, frozen header)", async () => {
  await backToDocuments();
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(["Item", "Cost"]); ws.addRow(["Chairs", 1234.5]); ws.getCell("B2").numFmt = "$#,##0.00";
  for (let i = 3; i <= 400; i++) ws.addRow([`Row ${i}`, i]);
  ws.mergeCells("D2:E3"); ws.getCell("D2").value = "Merged";
  wb.addWorksheet("Second").getCell("A1").value = "On sheet two";
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await page.getByTestId("doc-input").setInputFiles({ name: "budget.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await page.locator('[data-cell="B2"]').waitFor({ timeout: 30000 });
  const money = (await page.locator('[data-cell="B2"]').textContent())?.trim();
  if (money !== "$1,234.50") throw new Error(`B2 shows ${JSON.stringify(money)}`);
  if (!(await page.locator('[data-cell="D2"]').count())) throw new Error("merged cell missing");
  // Scroll far down: only nearby rows are drawn, and the frozen header stays.
  await page.getByTestId("sheet-scroller").evaluate((el) => { el.scrollTop = 7000; });
  await page.locator('[data-cell="A300"]').waitFor({ timeout: 10000 });
  if (await page.locator('[data-cell="A20"]').count()) throw new Error("rows far above the window are still drawn");
  if (!(await page.locator('[data-cell="A1"]').count())) throw new Error("frozen header row not drawn after scrolling");
  await page.getByRole("tab", { name: "Second" }).click();
  await page.locator('[data-cell="A1"]', { hasText: "On sheet two" }).waitFor({ timeout: 10000 });
});
await step("Documents: a non-document file is refused politely", async () => {
  await backToDocuments();
  await page.getByTestId("doc-input").setInputFiles({ name: "photo.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
  await page.getByText(/can't be viewed here/).waitFor({ timeout: 10000 });
});
await step("planner file is served", async () => {
  const r = await page.request.get(`${URL_}/stage-planner.html`);
  if (!r.ok()) throw new Error(`status ${r.status()}`);
});
await step("health endpoint", async () => {
  const r = await page.request.get(`${URL_}/__health`);
  if (!r.ok()) throw new Error(`status ${r.status()}`);
});
await page.screenshot({ path: process.env.SMOKE_SHOT || "smoke.png", fullPage: false }).catch(() => undefined);
await browser.close();

console.log(notes.join("\n"));
if (problems.length) {
  console.log("\nProblems:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}
console.log("\nSmoke test passed.");
