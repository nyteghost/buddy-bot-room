import { useEffect, useState } from "react";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SeerrQuery, SeerrResult } from "@/lib/seerr";

type RequestState = "idle" | "sending" | "done" | string;

/** @seerr <title> [4k] — look the title up, then confirm with a click before anything is requested. */
export function SeerrDialog({
  query,
  onClose,
  onRequested,
}: {
  query: SeerrQuery | null;
  onClose: () => void;
  onRequested: (summary: string) => void;
}) {
  const [results, setResults] = useState<SeerrResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [states, setStates] = useState<Record<number, RequestState>>({});

  useEffect(() => {
    if (!query) return;
    let stop = false;
    setResults([]);
    setStates({});
    setError("");
    if (!query.title) {
      setError("Add a title after @seerr, for example: @seerr Dune Part Two 4k");
      return;
    }
    setLoading(true);
    fetch(`/api/seerr?q=${encodeURIComponent(query.title)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Seerr lookup failed.");
        if (!stop) setResults(json.results ?? []);
      })
      .catch((err: unknown) => !stop && setError(err instanceof Error ? err.message : "Seerr lookup failed."))
      .finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [query]);

  async function request(r: SeerrResult) {
    if (!query) return;
    setStates((s) => ({ ...s, [r.id]: "sending" }));
    try {
      const res = await fetch("/api/seerr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaType: r.mediaType, mediaId: r.id, is4k: query.is4k }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Request failed.");
      setStates((s) => ({ ...s, [r.id]: "done" }));
      onRequested(`Requested ${r.title}${r.year ? ` (${r.year})` : ""} in ${query.is4k ? "4K" : "standard quality"} through Seerr.`);
    } catch (err) {
      setStates((s) => ({ ...s, [r.id]: err instanceof Error ? err.message : "Request failed." }));
    }
  }

  return (
    <Dialog open={query !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="seerr-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clapperboard className="size-4" /> Request “{query?.title}” {query?.is4k ? "in 4K" : ""}
          </DialogTitle>
          <DialogDescription>Pick the right match. Nothing is requested until you press Request.</DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Searching Seerr…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && results.length === 0 && <p className="text-sm text-muted-foreground">No movies or shows found.</p>}
        <ul className="seerr-list">
          {results.map((r) => {
            const state = states[r.id] ?? "idle";
            const have = query?.is4k ? r.status4k : r.status;
            return (
              <li key={`${r.mediaType}-${r.id}`}>
                <div>
                  <b>{r.title}</b> <span>{r.year} · {r.mediaType === "tv" ? "TV show" : "Movie"}</span>
                  {r.overview && <p>{r.overview}</p>}
                  {state !== "idle" && state !== "sending" && state !== "done" && <p className="text-destructive">{state}</p>}
                </div>
                <Button
                  size="sm"
                  disabled={state === "sending" || state === "done" || have !== "none"}
                  onClick={() => void request(r)}
                >
                  {state === "done" ? "Requested ✓" : have === "available" ? "Already there" : have === "requested" ? "Already requested" : state === "sending" ? "Sending…" : "Request"}
                </Button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
