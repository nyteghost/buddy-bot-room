import { useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cleanStore, DEFAULT_VENDORS, landed, newId, ranked, type Kind, type Offer, type Store } from "@/lib/vendors";

const KEY = "showpilot:vendors:v1";
function initial(): Store {
  try { return cleanStore(JSON.parse(localStorage.getItem(KEY) || "null")); }
  catch { return { items: [], vendors: DEFAULT_VENDORS }; }
}
function download(store: Store) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(store, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = "showpilot-vendors.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StandaloneVendors() {
  const [store, setStore] = useState<Store>(initial);
  const [kind, setKind] = useState<Kind>("buy");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [chosen, setChosen] = useState("");
  const [vendor, setVendor] = useState("");
  const [price, setPrice] = useState("");
  const [shipping, setShipping] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const save = (next: Store) => {
    const val = cleanStore(next); setStore(val);
    try { localStorage.setItem(KEY, JSON.stringify(val)); setStatus("Saved locally."); }
    catch { setStatus("Local storage is unavailable. Download a backup to avoid losing data."); }
  };
  const items = store.items.filter((item) => (item.kind ?? "buy") === kind);
  function addItem() {
    if (!name.trim()) return;
    if (store.items.length >= 60) { setStatus("Limit of 60 tracked items reached."); return; }
    save({ ...store, items: [...store.items, { id: newId(), name: name.trim(), unit: unit.trim(), kind, offers: [] }] });
    setName(""); setUnit("");
  }
  function addQuote() {
    const n = Number(price);
    const ship = shipping.trim() ? Number(shipping) : 0;
    if (!chosen || !vendor.trim() || !price.trim() || !Number.isFinite(n) || n < 0 ||
        !Number.isFinite(ship) || ship < 0) {
      setStatus("Select an item and enter a vendor, nonnegative price and shipping.");
      return;
    }
    const quote: Offer = { id: newId(), vendor: vendor.trim(), price: n, shipping: ship,
      checked: new Date().toISOString(), source: "quote", note: note.trim() };
    save({ ...store, items: store.items.map((item) => item.id === chosen ?
      { ...item, offers: [...item.offers, quote] } : item) });
    setVendor(""); setPrice(""); setShipping(""); setNote("");
  }
  async function importBackup(file: File) {
    try {
      if (file.size > 5_000_000) throw new Error("File exceeds 5 MB.");
      const raw: unknown = JSON.parse(await file.text());
      if (!raw || typeof raw !== "object" || !Array.isArray((raw as Partial<Store>).items)) {
        throw new Error("Not a vendor backup.");
      }
      const val = cleanStore(raw);
      if (!window.confirm("Replace saved vendor items with this backup?")) return;
      save(val); setStatus("Vendor backup imported.");
    } catch (e) { setStatus("Could not import vendor backup: " + (e as Error).message); }
  }
  return <section className="space-y-4 pt-3">
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
      Purchase and rental quotes work offline. Automatic vendor website updates and email quote extraction are not yet connected.
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={kind === "buy" ? "default" : "outline"} onClick={() => { setKind("buy"); setChosen(""); }}>Purchases</Button>
      <Button size="sm" variant={kind === "rent" ? "default" : "outline"} onClick={() => { setKind("rent"); setChosen(""); }}>Rentals</Button>
      <Button size="sm" variant="outline" onClick={() => download(store)}><Download className="size-4"/> Export vendor backup</Button>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs"><Upload className="size-4"/> Import backup
        <input className="sr-only" type="file" accept=".json" onChange={(e) => {
          const f = e.target.files?.[0]; if (f) void importBackup(f); e.target.value = "";
        }}/>
      </label>
    </div>
    <div className="grid gap-2 md:grid-cols-[1fr_10rem_auto]">
      <Input aria-label="Item name" placeholder={kind === "rent" ? "Rental equipment" : "Item to purchase"} value={name} onChange={(e) => setName(e.target.value)}/>
      <Input aria-label="Unit" placeholder={kind === "rent" ? "day" : "each"} value={unit} onChange={(e) => setUnit(e.target.value)}/>
      <Button disabled={!name.trim()} onClick={addItem}><Plus className="size-4"/> Add item</Button>
    </div>
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="font-semibold">Add vendor quote</h3>
      <div className="grid gap-2 md:grid-cols-4">
        <select aria-label="Quoted item" className="rounded-md border bg-background p-2 text-sm" value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Choose item</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Input aria-label="Vendor" placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)}/>
        <Input aria-label="Unit price" placeholder="Price ($)" value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)}/>
        <Input aria-label="Shipping" placeholder="Shipping ($)" value={shipping} inputMode="decimal" onChange={(e) => setShipping(e.target.value)}/>
      </div>
      <Input aria-label="Quote note" placeholder="Quote number or notes (optional)" value={note} onChange={(e) => setNote(e.target.value)}/>
      <Button disabled={!chosen || !vendor.trim() || !price.trim()} size="sm" onClick={addQuote}>Save quote</Button>
    </div>
    {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    {!items.length && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No {kind === "rent" ? "rental" : "purchase"} items yet.</p>}
    {items.map((item) => {
      const quotes = ranked(item);
      const best = quotes.find((q) => landed(q) !== undefined);
      return <article key={item.id} className="space-y-2 rounded-lg border p-4">
        <div className="flex items-start justify-between gap-2">
          <div><h3 className="font-semibold">{item.name}</h3><p className="text-xs text-muted-foreground">{item.unit || "per unit"} · {item.offers.length} quotes</p></div>
          <div className="flex items-center gap-3">
            {best && <span className="font-semibold text-sm">Best: ${landed(best)?.toFixed(2)}</span>}
            <Button variant="ghost" size="sm" onClick={() => save({ ...store, items: store.items.filter((x) => x.id !== item.id) })} aria-label={"Remove " + item.name}><Trash2 className="size-4"/></Button>
          </div>
        </div>
        {quotes.map((q) => <div key={q.id} className="flex items-center justify-between gap-2 border-t py-2 text-sm">
          <div><strong>{q.vendor}</strong>{q.note && <p className="text-xs text-muted-foreground">{q.note}</p>}</div>
          <div className="flex items-center gap-2">
            <span>{landed(q) === undefined ? "No price" : "$" + landed(q)?.toFixed(2)}</span>
            <Button variant="ghost" size="sm" aria-label={"Remove quote from " + q.vendor} onClick={() => save({
              ...store, items: store.items.map((x) => x.id === item.id ?
              { ...x, offers: x.offers.filter((o) => o.id !== q.id) } : x)
            })}><Trash2 className="size-4"/></Button>
          </div>
        </div>)}
      </article>;
    })}
  </section>;
}
