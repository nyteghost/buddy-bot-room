import { currentUser } from "./accounts.server";
import { cleanStore, clean, comparisonText, extractPrice, newId, pageText, parseAiQuotes, parseMoney, safeProductUrl, MAX_ITEMS, MAX_OFFERS, type Item, type Offer, type Store } from "./vendors";
import { logServer } from "./server-log.server";

/**
 * Vendor price comparison. Owner only. Prices live in BUDDY_DATA_DIR/vendors.json (included in backups).
 * Pages are fetched by this server, one at a time, never to addresses on your own network. Anything it can't read is
 * flagged so you can type the price in. Email quotes are only ever proposed: nothing is saved until you add it.
 */
const dir = () => (process.env["BUDDY_DATA_DIR"] ?? "").trim().replace(/\/+$/, "");
const fsp = async () => (await import(/* @vite-ignore */ "node:" + "fs/promises")) as typeof import("node:fs/promises");
const file = () => `${dir()}/vendors.json`;

async function load(): Promise<Store> {
  try { return cleanStore(JSON.parse(await (await fsp()).readFile(file(), "utf8"))); } catch { return cleanStore({}); }
}
let saving: Promise<unknown> = Promise.resolve();
async function save(s: Store): Promise<void> {
  const run = async () => {
    const f = await fsp();
    await f.mkdir(dir(), { recursive: true });
    await f.writeFile(`${file()}.tmp`, JSON.stringify(s), "utf8");
    await f.rename(`${file()}.tmp`, file());
  };
  saving = saving.then(run, run);
  await saving;
}

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function getPage(start: string): Promise<{ html: string } | { error: string }> {
  let url = start;
  for (let hop = 0; hop < 4; hop++) {
    const safe = safeProductUrl(url);
    if (!safe) return { error: "That link isn't a public web page." };
    let res: Response;
    try { res = await fetch(safe, { redirect: "manual", headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(12_000) }); }
    catch (e) { return { error: e instanceof Error && e.name === "TimeoutError" ? "The site didn't answer in time." : "Couldn't reach the site." }; }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { error: "The site redirected nowhere." };
      try { url = new URL(loc, safe).toString(); } catch { return { error: "Bad redirect." }; }
      continue;
    }
    if (res.status === 403 || res.status === 429 || res.status === 503) return { error: "The site blocked the automatic read. Type the price in." };
    if (!res.ok) return { error: `The site answered ${res.status}.` };
    const reader = res.body?.getReader();
    if (!reader) return { error: "Empty page." };
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 1_500_000) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); size += value.length; }
    void reader.cancel().catch(() => undefined);
    return { html: Buffer.concat(chunks).toString("utf8") };
  }
  return { error: "Too many redirects." };
}

async function aiPrice(html: string, itemName: string): Promise<number | undefined> {
  try {
    const { askPals } = await import(/* @vite-ignore */ "./ask" + ".server");
    const text = pageText(html);
    if (text.length < 80) return undefined;
    const r = await askPals(`Product wanted: "${itemName}".\nPage text:\n${text}\n\nWhat is the current selling price in US dollars of that product on this page (one unit, before tax)? Reply with only the number like 12.99, or NONE if the page does not show one.`, { localOnly: true, maxTokens: 20, system: "You read prices off shop pages. Answer with a single number or NONE. Never guess." });
    return r.ok ? parseMoney(r.text.match(/\d[\d,]*(?:\.\d{1,2})?/)?.[0]) : undefined;
  } catch { return undefined; }
}

/** Reads one offer's page and updates it in place. */
async function refreshOffer(o: Offer, itemName: string): Promise<void> {
  if (!o.url) return;
  const page = await getPage(o.url);
  if ("error" in page) { o.error = page.error; return; }
  const found = extractPrice(page.html);
  if (found) { o.price = found.price; o.source = "page"; o.checked = new Date().toISOString(); o.error = undefined; return; }
  const guess = await aiPrice(page.html, itemName);
  if (guess && guess > 0) { o.price = guess; o.source = "page-ai"; o.checked = new Date().toISOString(); o.error = undefined; return; }
  o.error = "No price found on that page. Type it in.";
}

async function owner(request: Request): Promise<Response | null> {
  const user = await currentUser(request);
  return user?.owner ? null : Response.json({ error: "Only the owner account can use Vendors here." }, { status: 403 });
}

type Body = {
  op?: string; item?: { id?: string; name?: string; unit?: string }; itemId?: string; offerId?: string;
  offer?: { id?: string; vendor?: string; url?: string; price?: unknown; shipping?: unknown; note?: string; source?: string };
  vendors?: string[]; vendor?: string; q?: string; question?: string;
};

export async function handleVendors(request: Request): Promise<Response> {
  const denied = await owner(request);
  if (denied) return denied;
  if (!dir()) return Response.json({ error: "Needs BUDDY_DATA_DIR (the data volume)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as Body;
  const s = await load();
  const find = (id: unknown) => s.items.find((i) => i.id === id);

  switch (body.op) {
    case "saveItem": {
      const name = clean(body.item?.name, 100);
      if (!name) return Response.json({ error: "Give the item a name." }, { status: 400 });
      const it = find(body.item?.id);
      if (it) { it.name = name; it.unit = clean(body.item?.unit, 30) || undefined; }
      else { if (s.items.length >= MAX_ITEMS) return Response.json({ error: "That's the most items I'll track." }, { status: 400 }); s.items.push({ id: newId(), name, unit: clean(body.item?.unit, 30) || undefined, offers: [] }); }
      await save(s);
      return Response.json(s);
    }
    case "deleteItem": { s.items = s.items.filter((i) => i.id !== body.itemId); await save(s); return Response.json(s); }
    case "saveOffer": {
      const it = find(body.itemId);
      const x = body.offer;
      const vendor = clean(x?.vendor, 60);
      if (!it || !x || !vendor) return Response.json({ error: "Pick an item and a vendor." }, { status: 400 });
      const url = x.url ? safeProductUrl(x.url) : undefined;
      if (x.url && !url) return Response.json({ error: "That link isn't a public web page." }, { status: 400 });
      const price = x.price === "" || x.price === undefined || x.price === null ? undefined : parseMoney(x.price);
      const existing = it.offers.find((o) => o.id === x.id);
      const o: Offer = existing ?? { id: newId(), vendor };
      if (!existing) { if (it.offers.length >= MAX_OFFERS) return Response.json({ error: "Too many vendors on one item." }, { status: 400 }); it.offers.push(o); }
      o.vendor = vendor; o.url = url ?? undefined; o.note = clean(x.note, 200) || undefined;
      o.shipping = x.shipping === "" || x.shipping === undefined || x.shipping === null ? undefined : parseMoney(x.shipping);
      if (price !== undefined && price !== o.price) { o.price = price; o.source = x.source === "email" ? "email" : "quote"; o.checked = new Date().toISOString(); o.error = undefined; }
      else if (price === undefined && !o.url) { o.price = undefined; }
      if (!s.vendors.includes(vendor)) s.vendors.push(vendor);
      if (o.url && price === undefined) await refreshOffer(o, it.name);
      await save(s);
      return Response.json(s);
    }
    case "deleteOffer": { const it = find(body.itemId); if (it) it.offers = it.offers.filter((o) => o.id !== body.offerId); await save(s); return Response.json(s); }
    case "refresh": {
      const targets: Item[] = body.itemId ? s.items.filter((i) => i.id === body.itemId) : s.items;
      const jobs = targets.flatMap((it) => it.offers.filter((o) => o.url).map((o) => ({ it, o })));
      for (const { it, o } of jobs.slice(0, 40)) { await refreshOffer(o, it.name); await new Promise((r) => setTimeout(r, 600)); }
      await save(s);
      return Response.json({ ...s, read: jobs.length });
    }
    case "mail": return mailQuotes(clean(body.q, 60));
    case "ask": return ask(s, clean(body.question, 300));
    default: return Response.json(s);
  }
}

async function ask(s: Store, question: string): Promise<Response> {
  if (!s.items.length) return Response.json({ error: "Add some items first." }, { status: 400 });
  const { askPals } = await import(/* @vite-ignore */ "./ask" + ".server");
  const r = await askPals(`${question || "Which vendor is cheapest for each item, and is anything worth checking?"}\n\nPrices (before tax, I'm tax-exempt; OLD means over a month old):\n${comparisonText(s.items)}`, {
    localOnly: true, maxTokens: 500,
    system: "You compare vendor prices for a convention center buyer. Use only the numbers given. Name the cheapest vendor per item (price plus shipping), call out old or AI-read prices that need checking, and keep it short. Do not invent prices.",
  });
  return r.ok ? Response.json({ answer: r.text, via: r.via }) : Response.json({ error: r.error }, { status: 502 });
}

/** Looks through the mailbox for a vendor and asks the local AI for quoted prices. Proposes only; nothing is saved. */
async function mailQuotes(q: string): Promise<Response> {
  if (!q || !/^[\x20-\x7e]{2,60}$/.test(q)) return Response.json({ error: "Type the vendor's name or email domain to look for." }, { status: 400 });
  const { imapConfig } = await import(/* @vite-ignore */ "./imap" + ".server");
  const cfg = imapConfig();
  if (!cfg) return Response.json({ error: "Email isn't set up in Settings (IMAP)." }, { status: 503 });
  try {
    const { listMessages, readMessage } = await import(/* @vite-ignore */ "./mailbox" + ".server");
    const { askPals } = await import(/* @vite-ignore */ "./ask" + ".server");
    const list = await listMessages(cfg, { q, limit: 6 });
    const out: { from: string; subject: string; date: string; quotes: ReturnType<typeof parseAiQuotes> }[] = [];
    for (const m of list.messages.slice(0, 5)) {
      const full = await readMessage(cfg, list.folder, m.uid, false);
      const r = await askPals(`Email from ${full.from} (${full.date}), subject "${full.subject}":\n\n${full.text.slice(0, 5000)}\n\nList every priced item quoted in this email as a JSON array like [{"item":"flat cord 50ft","price":12.5,"unit":"each","shipping":0,"note":"valid 30 days"}]. Price is per unit in US dollars. Reply with [] if the email quotes no prices.`, {
        localOnly: true, maxTokens: 600, system: "You extract quoted prices from vendor emails into JSON. Output only the JSON array. Never invent a price that is not in the email.",
      });
      const quotes = r.ok ? parseAiQuotes(r.text) : [];
      if (quotes.length) out.push({ from: full.from, subject: full.subject, date: full.date, quotes });
    }
    return Response.json({ found: list.messages.length, emails: out });
  } catch (e) {
    logServer("warn", `vendor mail scan failed: ${e instanceof Error ? e.message : "failed"}`);
    return Response.json({ error: e instanceof Error ? e.message.slice(0, 140) : "Couldn't read the mailbox." }, { status: 502 });
  }
}
