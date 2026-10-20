import { useEffect, useState } from "react";
import { Mail, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cheapest, DEFAULT_VENDORS, isStale, landed, ranked, sourceLabel, type Item, type Offer, type Proposed, type Store } from "@/lib/vendors";
import { MessageResponse } from "@/components/ai-elements/message";

type Reply = Partial<Store> & { error?: string; read?: number; answer?: string; via?: string; found?: number; emails?: { from: string; subject: string; date: string; quotes: Proposed[] }[] };
const call = async (body: object): Promise<Reply> => {
  try { return (await (await fetch("/api/vendors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Reply; }
  catch { return { error: "Couldn't reach the server." }; }
};
type Run = (b: object, ok?: string | undefined) => Promise<void>;
const usd = (n: number | undefined) => (n === undefined ? "—" : `$${n.toFixed(2)}`);

export function VendorsPanel() {
  const [store, setStore] = useState<Store | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [answer, setAnswer] = useState("");
  const [mailQ, setMailQ] = useState("");
  const [mail, setMail] = useState<Reply["emails"]>();

  const apply = (r: Reply, ok = "") => {
    if (r.error) { setStatus(r.error); return; }
    if (r.items) setStore({ items: r.items, vendors: r.vendors ?? DEFAULT_VENDORS });
    setStatus(ok);
  };
  const run: Run = async (body, ok = "") => { setBusy(true); apply(await call(body), ok); setBusy(false); };
  useEffect(() => { call({ op: "list" }).then((r) => (r.error ? setStatus(r.error) : apply(r))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!store) return <p className="pt-2 text-sm text-muted-foreground">{status || "Loading…"}</p>;
  const addProposal = async (itemName: string, q: Proposed, from: string) => {
    let it = store.items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
    if (!it) {
      const made = await call({ op: "saveItem", item: { name: itemName, unit: q.unit } });
      if (made.error || !made.items) return setStatus(made.error ?? "Couldn't add the item.");
      it = made.items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
    }
    if (!it) return;
    await run({ op: "saveOffer", itemId: it.id, offer: { vendor: mailQ || from, price: q.price, shipping: q.shipping, note: q.note ?? "", source: "email" } }, `Added a quote for ${itemName}.`);
  };

  return (
    <div className="space-y-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-40 flex-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Item, like 50ft flat power cord" aria-label="Item name" />
        <Input className="w-24" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="each" aria-label="Unit" />
        <Button size="sm" disabled={busy || !name.trim()} onClick={async () => { await run({ op: "saveItem", item: { name, unit } }); setName(""); setUnit(""); }}><Plus className="size-4" /> Add item</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !store.items.length} onClick={() => run({ op: "refresh" }, "Prices refreshed.")}><RefreshCw className="size-4" /> Refresh all pages</Button>
        <Button size="sm" variant="outline" disabled={busy || !store.items.length} onClick={async () => { setBusy(true); setAnswer(""); const r = await call({ op: "ask" }); if (r.error) setStatus(r.error); else { setAnswer(r.answer ?? ""); setStatus(r.via ? `Answered by ${r.via}` : ""); } setBusy(false); }}><Sparkles className="size-4" /> Who's cheapest?</Button>
      </div>
      {answer && <div className="rounded-md border border-border p-3 text-sm"><MessageResponse>{answer}</MessageResponse></div>}
      {status && <p className="text-xs text-muted-foreground" role="status">{status}</p>}

      {!store.items.length && <p className="text-sm text-muted-foreground">Add an item, then add each vendor's product link or the price you were quoted. Pages that publish a price are read for you; the rest you type in once.</p>}
      {store.items.map((it) => <ItemCard key={it.id} item={it} vendors={store.vendors} busy={busy} run={run} />)}

      <div className="space-y-2 rounded-md border border-dashed border-border p-3">
        <div className="flex items-center gap-2 text-sm font-medium"><Mail className="size-4" /> Pull quotes from email</div>
        <div className="flex gap-2">
          <Input value={mailQ} onChange={(e) => setMailQ(e.target.value)} placeholder="Vendor name or email domain, like sico.com" aria-label="Vendor to look for in email" />
          <Button size="sm" variant="outline" disabled={busy || mailQ.trim().length < 2} onClick={async () => { setBusy(true); setMail(undefined); const r = await call({ op: "mail", q: mailQ }); if (r.error) setStatus(r.error); else { setMail(r.emails ?? []); setStatus(`Looked through ${r.found ?? 0} email${r.found === 1 ? "" : "s"}.`); } setBusy(false); }}>Scan</Button>
        </div>
        {mail && !mail.length && <p className="text-xs text-muted-foreground">No prices found in those emails.</p>}
        {mail?.map((m, i) => (
          <div key={i} className="space-y-1 rounded border border-border p-2 text-xs">
            <div className="font-medium">{m.subject} <span className="font-normal text-muted-foreground">— {m.from}</span></div>
            {m.quotes.map((q, j) => (
              <div key={j} className="flex items-center justify-between gap-2">
                <span>{q.item}: <strong>{usd(q.price)}</strong>{q.unit ? ` / ${q.unit}` : ""}{q.note ? ` · ${q.note}` : ""}</span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => addProposal(q.item, q, m.from)}>Add</Button>
              </div>
            ))}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Read by your local AI and only suggested. Check each price against the email before you add it.</p>
      </div>
      <p className="text-xs text-muted-foreground">Prices are before tax (you're tax-exempt). Shipping is added when you enter it.</p>
    </div>
  );
}

function ItemCard({ item, vendors, busy, run }: { item: Item; vendors: string[]; busy: boolean; run: Run }) {
  const best = cheapest(item);
  const [adding, setAdding] = useState(false);
  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{item.name}{item.unit ? <span className="font-normal text-muted-foreground"> · per {item.unit}</span> : null}</div>
        <div className="flex gap-1">
          {item.offers.some((o) => o.url) && <Button size="icon" variant="ghost" aria-label="Refresh this item" disabled={busy} onClick={() => run({ op: "refresh", itemId: item.id }, "Refreshed.")}><RefreshCw className="size-4" /></Button>}
          <Button size="icon" variant="ghost" aria-label="Delete item" disabled={busy} onClick={() => { if (window.confirm(`Delete ${item.name} and its prices?`)) void run({ op: "deleteItem", itemId: item.id }); }}><Trash2 className="size-4" /></Button>
        </div>
      </div>
      <ul className="mt-1 space-y-1">
        {ranked(item).map((o) => <OfferRow key={o.id} offer={o} best={best?.id === o.id && item.offers.filter((x) => landed(x) !== undefined).length > 1} item={item} vendors={vendors} busy={busy} run={run} />)}
      </ul>
      {adding
        ? <OfferForm vendors={vendors} busy={busy} onCancel={() => setAdding(false)} onSave={async (offer) => { await run({ op: "saveOffer", itemId: item.id, offer }); setAdding(false); }} />
        : <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAdding(true)}><Plus className="size-4" /> Add vendor</Button>}
    </div>
  );
}

function OfferRow({ offer: o, best, item, vendors, busy, run }: { offer: Offer; best: boolean; item: Item; vendors: string[]; busy: boolean; run: Run }) {
  const [edit, setEdit] = useState(false);
  if (edit) return <li><OfferForm initial={o} vendors={vendors} busy={busy} onCancel={() => setEdit(false)} onSave={async (offer) => { await run({ op: "saveOffer", itemId: item.id, offer: { ...offer, id: o.id } }); setEdit(false); }} /></li>;
  return (
    <li className={`flex items-start justify-between gap-2 rounded px-2 py-1 text-sm ${best ? "bg-primary/10" : ""}`}>
      <div className="min-w-0">
        <div>
          {o.url ? <a className="font-medium text-primary underline" href={o.url} target="_blank" rel="noreferrer">{o.vendor}</a> : <span className="font-medium">{o.vendor}</span>}
          {best && <span className="ml-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">CHEAPEST</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          {o.price !== undefined ? sourceLabel(o) : "no price yet"}{isStale(o) && o.price !== undefined ? " · old, check again" : ""}{o.note ? ` · ${o.note}` : ""}
        </div>
        {o.error && <div className="text-xs text-destructive">{o.error}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <div className="text-right">
          <div className="font-semibold">{usd(o.price)}</div>
          {o.shipping ? <div className="text-xs text-muted-foreground">+{usd(o.shipping)} ship</div> : null}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>Edit</Button>
        <Button size="icon" variant="ghost" aria-label={`Remove ${o.vendor}`} disabled={busy} onClick={() => run({ op: "deleteOffer", itemId: item.id, offerId: o.id })}><Trash2 className="size-4" /></Button>
      </div>
    </li>
  );
}

function OfferForm({ initial, vendors, busy, onSave, onCancel }: { initial?: Offer; vendors: string[]; busy: boolean; onSave: (o: { vendor: string; url: string; price: string; shipping: string; note: string }) => void | Promise<void>; onCancel: () => void }) {
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [price, setPrice] = useState(initial?.price === undefined ? "" : String(initial.price));
  const [shipping, setShipping] = useState(initial?.shipping === undefined ? "" : String(initial.shipping));
  const [note, setNote] = useState(initial?.note ?? "");
  return (
    <div className="mt-1 grid gap-2 rounded border border-border p-2 sm:grid-cols-2">
      <Input list="vendor-names" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor" aria-label="Vendor" />
      <datalist id="vendor-names">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Product link (optional, read automatically)" aria-label="Product link" />
      <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="Price you were quoted (leave empty to read the link)" aria-label="Price" />
      <Input value={shipping} onChange={(e) => setShipping(e.target.value)} inputMode="decimal" placeholder="Shipping (optional)" aria-label="Shipping" />
      <Input className="sm:col-span-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, like quote #123, min order 10, good till Nov 30" aria-label="Note" />
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" disabled={busy || !vendor.trim() || (!url.trim() && !price.trim())} onClick={() => onSave({ vendor, url, price, shipping, note })}>Save</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
