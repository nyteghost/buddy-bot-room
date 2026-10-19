import { useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, readUIMessageStream } from "ai";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageResponse } from "@/components/ai-elements/message";
import { agents, messageText, models, type RoomMessage } from "@/lib/agents";
import { availableProviders, freeModels, replyTokens, useEngine } from "@/lib/engine";
import { hasWebGPU, localTurn, ollamaTurn } from "@/lib/local-llm";
import { useOllamaModels } from "@/lib/ollama-models";
import { replaceEmojiShortcodes } from "@/lib/emoji-shortcodes";
import {
  BLIND_LABELS,
  MAX_CONTESTANTS,
  MIN_CONTESTANTS,
  NEUTRAL_SYSTEM,
  buildContestants,
  isLocal,
  leaderboard,
  loadScores,
  recordVote,
  saveScores,
  shuffled,
  type Contestant,
  type Scores,
} from "@/lib/compare";
import { cn } from "@/lib/utils";

type Entry = { contestant: Contestant; text: string; state: "waiting" | "running" | "done" | "error"; error?: string; seconds?: number };
type Phase = "setup" | "running" | "voting" | "revealed";

/** Blind side-by-side model test: same question, hidden names, you vote, then the reveal. */
export function CompareDialog({
  open,
  onOpenChange,
  initialQuestion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuestion: string;
}) {
  const engine = useEngine();
  const installed = useOllamaModels(engine.ollamaUrl, open);
  const [question, setQuestion] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("setup");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [scores, setScores] = useState<Scores>({});
  const [winner, setWinner] = useState<string | null | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const contestants: Contestant[] = useMemo(
    () =>
      buildContestants({
        providers: availableProviders(engine).map((p) => p.kind),
        ollamaModels: installed.length ? installed : [engine.ollamaModel],
        webgpu: hasWebGPU(),
      }),
    [engine, installed],
  );
  const labelOf = (id: string) => contestants.find((c) => c.id === id)?.label ?? id;

  useEffect(() => {
    if (!open) return;
    setQuestion(initialQuestion);
    setScores(loadScores());
    setPhase("setup");
    setEntries([]);
    setWinner(undefined);
  }, [open, initialQuestion]);
  useEffect(() => () => abortRef.current?.abort(), []);
  // Start with the first two contestants ticked so a test is one click away.
  useEffect(() => {
    if (open && picked.length === 0 && contestants.length >= MIN_CONTESTANTS)
      setPicked(contestants.slice(0, MIN_CONTESTANTS).map((c) => c.id));
  }, [open, contestants, picked.length]);

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : current.length >= MAX_CONTESTANTS ? current : [...current, id],
    );
  }

  async function streamFor(c: Contestant, q: string, signal: AbortSignal) {
    const prompt = { system: NEUTRAL_SYSTEM, messages: [{ role: "user" as const, content: q }] };
    if (c.kind === "ollama")
      return ollamaTurn(prompt, { url: engine.ollamaUrl, model: c.model ?? engine.ollamaModel, maxTokens: replyTokens[engine.replyLength] }, {}, signal);
    if (c.kind === "webgpu") return localTurn(prompt, {}, signal);
    const apiKey = availableProviders(engine).find((p) => p.kind === c.kind)?.apiKey ?? "";
    return new DefaultChatTransport<RoomMessage>({
      api: "/api/chat",
      body: { agentId: agents[0]?.id, model: models[0]?.id, mode: "direct", neutral: true, engine: { kind: c.kind, apiKey } },
    }).sendMessages({
      chatId: "pixel-pals-compare",
      messageId: undefined,
      messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: q }] }],
      trigger: "submit-message",
      abortSignal: signal,
    });
  }

  async function start() {
    const q = question.trim();
    if (!q || picked.length < MIN_CONTESTANTS) return;
    const chosen: Contestant[] = shuffled(picked.map((id) => contestants.find((c) => c.id === id)).filter((c): c is Contestant => !!c));
    const controller = new AbortController();
    abortRef.current = controller;
    setEntries(chosen.map((contestant) => ({ contestant, text: "", state: "waiting" })));
    setWinner(undefined);
    setPhase("running");

    const patch = (i: number, change: Partial<Entry>) =>
      setEntries((current) => current.map((e, idx) => (idx === i ? { ...e, ...change } : e)));
    async function runOne(contestant: Contestant, i: number) {
      const began = performance.now();
      patch(i, { state: "running" });
      try {
        const stream = await streamFor(contestant, q, controller.signal);
        let text = "";
        for await (const partial of readUIMessageStream<RoomMessage>({ stream, terminateOnError: true })) {
          text = messageText(partial);
          patch(i, { text });
        }
        if (!text.trim()) throw new Error("No answer came back.");
        patch(i, { state: "done", seconds: (performance.now() - began) / 1000 });
      } catch (err) {
        if (controller.signal.aborted) return;
        patch(i, { state: "error", error: err instanceof Error ? err.message : "Failed." });
      }
    }
    // Cloud models answer together; local ones take turns so one GPU isn't asked to juggle models.
    const jobs = chosen.map((contestant, i) => ({ contestant, i }));
    const localJobs = jobs.filter((j) => isLocal(j.contestant));
    await Promise.all([
      ...jobs.filter((j) => !isLocal(j.contestant)).map((j) => runOne(j.contestant, j.i)),
      (async () => {
        for (const j of localJobs) await runOne(j.contestant, j.i);
      })(),
    ]);
    if (!controller.signal.aborted) setPhase("voting");
  }

  function vote(winnerId: string | null) {
    const next = recordVote(scores, winnerId, entries.map((e) => e.contestant.id));
    setScores(next);
    saveScores(next);
    setWinner(winnerId);
    setPhase("revealed");
  }

  function close(next: boolean) {
    if (!next) abortRef.current?.abort();
    onOpenChange(next);
  }

  const ready = question.trim() && picked.length >= MIN_CONTESTANTS && phase === "setup";
  const board = leaderboard(scores);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="compare-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="size-4" /> Compare models
          </DialogTitle>
          <DialogDescription>
            Same question, hidden names. Read the answers, pick the best one, then see who wrote what.
          </DialogDescription>
        </DialogHeader>

        {phase === "setup" && (
          <div className="grid gap-3 text-sm">
            <label className="grid gap-1">
              <span className="font-medium">Question</span>
              <textarea
                aria-label="Compare question"
                className="min-h-20 rounded-md border border-input bg-background p-2"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Explain how a rainbow forms, in plain words."
              />
            </label>
            <fieldset className="grid gap-1">
              <legend className="font-medium">
                Contestants <span className="text-muted-foreground">(pick {MIN_CONTESTANTS}–{MAX_CONTESTANTS})</span>
              </legend>
              {contestants.length === 0 && <p className="text-muted-foreground">Add a free key or turn on Ollama in AI engine settings first.</p>}
              {contestants.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span>{c.label}</span>
                  {c.kind in freeModels && <span className="text-xs text-muted-foreground">{freeModels[c.kind as keyof typeof freeModels]}</span>}
                </label>
              ))}
            </fieldset>
            <Button disabled={!ready} onClick={() => void start()}>
              Start blind test
            </Button>
          </div>
        )}

        {phase !== "setup" && (
          <div className="compare-grid">
            {entries.map((e, i) => (
              <section key={e.contestant.id} className={cn("compare-card", winner === e.contestant.id && "compare-winner")}>
                <h3>
                  {phase === "revealed" ? e.contestant.label : `Answer ${BLIND_LABELS[i]}`}
                  {phase === "revealed" && e.seconds !== undefined && <span> · {e.seconds.toFixed(1)}s</span>}
                </h3>
                {e.state === "error" ? (
                  <p className="text-destructive">{e.error}</p>
                ) : e.text ? (
                  <MessageResponse>{replaceEmojiShortcodes(e.text)}</MessageResponse>
                ) : (
                  <p className="text-muted-foreground">{e.state === "waiting" ? "Waiting its turn…" : "Thinking…"}</p>
                )}
              </section>
            ))}
          </div>
        )}

        {phase === "running" && (
          <Button variant="outline" onClick={() => { abortRef.current?.abort(); setPhase("setup"); }}>
            Stop
          </Button>
        )}

        {phase === "voting" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Which answer was best?</span>
            {entries.map((e, i) => (
              <Button key={e.contestant.id} size="sm" disabled={e.state === "error"} onClick={() => vote(e.contestant.id)}>
                {BLIND_LABELS[i]}
              </Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => vote(null)}>
              Tie
            </Button>
          </div>
        )}

        {phase === "revealed" && (
          <div className="grid gap-2 text-sm">
            <p>{winner ? `${labelOf(winner)} wins this round.` : "It's a tie."}</p>
            {board.length > 0 && (
              <ol className="compare-board">
                {board.map((row) => (
                  <li key={row.id}>
                    <b>{labelOf(row.id)}</b> — {row.wins} win{row.wins === 1 ? "" : "s"} in {row.games} ({Math.round(row.rate * 100)}%)
                  </li>
                ))}
              </ol>
            )}
            <Button variant="outline" onClick={() => { setPhase("setup"); setEntries([]); setWinner(undefined); }}>
              New round
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
