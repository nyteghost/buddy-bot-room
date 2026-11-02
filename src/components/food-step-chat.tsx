import { scrubChatText } from "@/lib/chat-scrub";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { foodChatBody, foodChatPlace, type FoodChatTurn } from "@/lib/food-chat";
import type { FoodSession } from "@/lib/focus-food";

export function FoodStepChat({
  session,
  open,
  onHistory,
  onReturn,
}: {
  session: FoodSession;
  open: boolean;
  onHistory: (history: FoodChatTurn[]) => void;
  onReturn: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const pending = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const currentPlace = useRef({ index: session.index, stage: session.stage });
  currentPlace.current = { index: session.index, stage: session.stage };
  const history = session.chatHistory ?? [];
  const place = foodChatPlace(session.stage, session.index);
  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
  };
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setNote("");
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [open, session.index, session.stage]);
  useEffect(() => {
    if (expanded && open) input.current?.focus();
  }, [expanded, open]);
  useEffect(() => {
    if (expanded && open && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [history.length, expanded, open]);
  const ask = async () => {
    if (!question.trim() || question.length > 1000 || busy || !open) return;
    const body = foodChatBody(session, question);
    if (!body) {
      setNote(
        "This recipe is too large for step chat. Its complete instructions remain available; open the original source for clarification.",
      );
      return;
    }
    cancel();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setNote("");
    const asked = {
      question: scrubChatText(question.trim()),
      index: session.index,
      stage: session.stage,
    };
    try {
      const response = await fetch("/api/focus-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      const data = await response.json();
      if (
        controller.signal.aborted ||
        pending.current !== controller ||
        currentPlace.current.index !== asked.index ||
        currentPlace.current.stage !== asked.stage
      )
        return;
      if (
        !response.ok ||
        typeof data.text !== "string" ||
        !data.text.trim() ||
        data.text.length > 3000
      ) {
        setNote(
          typeof data.error === "string"
            ? data.error
            : "Local AI could not answer. Retry or check Connect Ollama. Your recipe and timer are unchanged.",
        );
        return;
      }
      onHistory([...history, { ...asked, answer: scrubChatText(data.text.trim()) }].slice(-6));
      setQuestion("");
    } catch {
      if (!controller.signal.aborted)
        setNote(
          "Could not reach the cooking assistant. Check Connect Ollama or retry; your question, recipe and timer are still here.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section className="food-step-chat" aria-label="Recipe step chat">
      {!expanded ? (
        <Button variant="outline" aria-expanded={false} onClick={() => setExpanded(true)}>
          Ask about this step
        </Button>
      ) : (
        <div className="food-notice">
          <div className="food-actions">
            <h3>Cooking chat · {place}</h3>
            <Button
              variant="outline"
              onClick={() => {
                cancel();
                setExpanded(false);
                setNote("");
                onReturn();
              }}
            >
              Back to recipe
            </Button>
          </div>
          <p>
            <strong>{session.recipe.title}</strong>
          </p>
          <p className="food-muted">
            Local AI receives this recipe, your current place and recent cooking questions. Answers
            are guidance alongside the original instructions; they do not change your recipe or mark
            a step done.
          </p>
          {session.stage === "cook" && (
            <details>
              <summary>Current original instruction</summary>
              <p className="food-original">{session.recipe.steps[session.index]}</p>
            </details>
          )}
          {session.timer && (
            <p className="food-muted">
              Your cooking timer continues while chatting. Use a kitchen or phone alarm for critical
              timing.
            </p>
          )}
          <div
            ref={transcript}
            className="food-chat-history"
            role="log"
            aria-label="Cooking conversation"
            aria-live="polite"
            aria-relevant="additions"
          >
            {history.map((turn, i) => (
              <article className="food-card" key={i}>
                <p className="food-muted">Asked during {foodChatPlace(turn.stage, turn.index)}</p>
                <p className="food-original">
                  <strong>You:</strong> {turn.question}
                </p>
                <p className="food-original">
                  <strong>Local AI:</strong> {turn.answer}
                </p>
              </article>
            ))}
            {!history.length && (
              <p>
                Ask what a term means, what to gather, or how this step relates to the rest of your
                recipe.
              </p>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask();
            }}
          >
            <label>
              Question about this recipe
              <textarea
                ref={input}
                rows={3}
                maxLength={1000}
                value={question}
                onChange={(e) => setQuestion(scrubChatText(e.target.value))}
                placeholder="What does this instruction mean?"
              />
            </label>
            <div className="food-actions">
              <Button type="submit" disabled={busy || !open || !question.trim()}>
                Ask cooking assistant
              </Button>
              {busy && (
                <Button type="button" variant="ghost" onClick={cancel}>
                  Stop answer
                </Button>
              )}
            </div>
          </form>
          {busy && (
            <p role="status">Asking Local AI about {place.toLowerCase()}… Your place is saved.</p>
          )}
          {note && <p role="status">{note}</p>}
          <p className="food-muted">
            The latest six answered questions save with this cooking session in this browser.
            Closing chat keeps them; clearing the recipe clears its chat. The assistant cannot see
            your food or verify doneness.
          </p>
        </div>
      )}
    </section>
  );
}
