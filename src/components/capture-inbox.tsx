import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import type { Capture } from "@/lib/capture";
import { AUDIO_TYPES, MAX_AUDIO, type Suggestion } from "@/lib/capture-inbox";
import { scrubChatText } from "@/lib/chat-scrub";
const captureId = () =>
  globalThis.crypto?.randomUUID?.() ??
  "capture-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
type InboxData = {
  items: Capture[];
  projects: { id: string; name: string }[];
  enabled: boolean;
  voiceConfigured: boolean;
  limit: number;
};
async function call(body?: unknown) {
  const r = await fetch(
    "/api/inbox",
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Capture request failed");
  return d;
}
export function CaptureInbox({
  open,
  initialId,
  initialFilter,
  onStart,
}: {
  open: boolean;
  initialId?: string | undefined;
  initialFilter?: string | undefined;
  onStart: (task: string) => void;
}) {
  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);
  useEffect(() => {
    const select = (e: Event) => {
      if ((e as CustomEvent<{ filter?: string }>).detail?.filter === "parked") setFilter("parked");
    };
    window.addEventListener("pixelpals:inbox", select);
    return () => window.removeEventListener("pixelpals:inbox", select);
  }, []);
  const [data, setData] = useState<InboxData | null>(null),
    [text, setText] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("pending"),
    [voice, setVoice] = useState<Blob | null>(null),
    [recording, setRecording] = useState(false);
  const [editor, setEditor] = useState<{ capture: Capture; suggestion: Suggestion } | null>(null),
    [kind, setKind] = useState<Suggestion["kind"]>("task"),
    [value, setValue] = useState(""),
    [step, setStep] = useState(""),
    [minutes, setMinutes] = useState(""),
    [materials, setMaterials] = useState(""),
    [scope, setScope] = useState("private"),
    [project, setProject] = useState("");
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    draftId = useRef(captureId());
  const visible = useRef(open);
  visible.current = open;
  const [secure, setSecure] = useState(false),
    [canRecord, setCanRecord] = useState(false);
  useEffect(() => {
    setSecure(globalThis.isSecureContext);
    setCanRecord(
      !!globalThis.isSecureContext &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined",
    );
  }, []);
  const refresh = async () => {
    try {
      setData(await call());
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  useEffect(() => {
    try {
      setText(scrubChatText(localStorage.getItem("pixel-pals-capture-draft") ?? ""));
    } catch {
      /* Optional storage. */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("pixel-pals-capture-draft", text);
    } catch {
      /* Optional storage. */
    }
  }, [text]);
  useEffect(() => {
    if (open) {
      void refresh();
      const tick = setInterval(() => {
        if (!editor) void refresh();
      }, 10000);
      return () => clearInterval(tick);
    } else if (recorder.current?.state === "recording") recorder.current.stop();
    return undefined;
    // Refresh while visible; an open editor keeps its revision and text stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, !!editor]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  const mutate = async (body: unknown) => {
    setBusy(true);
    try {
      const d = await call(body);
      setNote("Saved.");
      await refresh();
      window.dispatchEvent(new Event("pixelpals:inbox-changed"));
      return d;
    } catch (e) {
      setNote((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const record = async () => {
    if (recording) {
      if (recorder.current?.state === "recording") recorder.current.stop();
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!visible.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = mic;
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(mic, mime ? { mimeType: mime } : {});
      recorder.current = rec;
      const chunks: Blob[] = [];
      let size = 0;
      rec.ondataavailable = (e) => {
        size += e.data.size;
        if (size <= MAX_AUDIO) chunks.push(e.data);
        else if (rec.state === "recording") rec.stop();
      };
      rec.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        mic.getTracks().forEach((t) => t.stop());
        recorder.current = null;
        setRecording(false);
        if (size > MAX_AUDIO) {
          setNote("Recording exceeded 8 MB; please record a shorter memo.");
          return;
        }
        setVoice(new Blob(chunks, { type: rec.mimeType.split(";")[0] ?? "audio/webm" }));
        setNote("Recording ready. Press Save voice memo to send it to Unraid.");
      };
      rec.start(1000);
      setRecording(true);
      timer.current = setTimeout(() => {
        if (rec.state === "recording") rec.stop();
      }, 120000);
    } catch {
      setNote("Recording is unavailable here. Upload a voice memo or type your thought.");
    }
  };
  const upload = async () => {
    if (!voice) return;
    setBusy(true);
    try {
      const type = voice.type.split(";")[0]!;
      if (!AUDIO_TYPES[type] || voice.size > MAX_AUDIO)
        throw Error("Choose a supported voice memo under 8 MB.");
      const r = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": type },
        body: voice,
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Could not save voice memo");
      setVoice(null);
      setNote("Saved on Unraid. Local transcription is queued.");
      await refresh();
      window.dispatchEvent(new Event("pixelpals:inbox-changed"));
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const edit = async (c: Capture, s: Suggestion) => {
    const d = await mutate({ op: "pause", id: c.id, revision: c.inbox!.revision });
    if (!d?.item) return;
    setEditor({ capture: d.item, suggestion: s });
    setKind(s.kind);
    setValue(s.text);
    setStep(s.firstStep);
    setMinutes(s.minutes ? String(s.minutes) : "");
    setMaterials(s.materials.join("\n"));
    setScope("private");
    setProject("");
  };
  const approve = async (start = false) => {
    if (!editor) return;
    const d = await mutate({
      op: "approve",
      id: editor.capture.id,
      revision: editor.capture.inbox!.revision,
      suggestion: editor.suggestion.id,
      kind,
      text: value,
      firstStep: step,
      minutes: minutes ? Number(minutes) : null,
      materials: materials.split("\n"),
      scope,
      project,
    });
    if (d) {
      setEditor(null);
      if (start && kind === "task") onStart(value + (step ? "\nFirst step: " + step : ""));
    }
  };
  return (
    <section className="grid gap-4 p-3 text-sm" aria-label="Capture Inbox">
      <h2 className="font-semibold">Capture first. Sort it when you’re ready.</h2>
      <p className="text-muted-foreground">
        Thoughts stay on Unraid. Suggested actions need your approval.
      </p>
      {note && (
        <p role="status" className="rounded-md border p-2">
          {note}
        </p>
      )}
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            if (await mutate({ op: "add", id: draftId.current, text })) {
              setText("");
              draftId.current = captureId();
            }
          })();
        }}
      >
        <label>
          Capture a thought
          <textarea
            className="w-full rounded-md border bg-background p-2 text-base"
            value={text}
            maxLength={4000}
            onChange={(e) => setText(scrubChatText(e.target.value))}
            rows={3}
            placeholder="What’s on your mind?"
          />
        </label>
        <Button disabled={busy || !text.trim()}>Save thought</Button>
      </form>
      <details>
        <summary className="cursor-pointer py-2">Voice memo</summary>
        <div className="grid gap-2">
          <p>
            Audio stays on Unraid until transcription or deletion. Recognizable credentials are
            removed from the transcript; audio itself cannot be scrubbed.
          </p>
          <Button
            variant="outline"
            disabled={busy || (!recording && !canRecord)}
            onClick={() => void record()}
          >
            {recording ? "Stop recording" : "Record voice memo"}
          </Button>
          {!secure && (
            <p className="text-muted-foreground">
              Live recording requires HTTPS. Upload a voice memo or type on this connection.
            </p>
          )}
          <label>
            Upload voice memo
            <input
              type="file"
              accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const extension = file.name.split(".").pop()?.toLowerCase();
                  const guessed = Object.entries(AUDIO_TYPES).find(
                    ([, ext]) => ext === extension,
                  )?.[0];
                  setVoice(
                    AUDIO_TYPES[file.type] ? file : new Blob([file], { type: guessed ?? "" }),
                  );
                }
                e.target.value = "";
              }}
            />
          </label>
          {voice && (
            <>
              <p>{(voice.size / 1024).toFixed(0)} KB ready to save (8 MB maximum).</p>
              <Button disabled={busy} onClick={() => void upload()}>
                Save voice memo
              </Button>
              <Button variant="ghost" onClick={() => setVoice(null)}>
                Discard unsaved recording
              </Button>
            </>
          )}
          {data && !data.voiceConfigured && (
            <Button
              variant="outline"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("pixelpals:configure-integration", { detail: { id: "whisper" } }),
                )
              }
            >
              Configure local transcription
            </Button>
          )}
        </div>
      </details>
      {data && !data.enabled && (
        <p>
          Background capture processing is paused. Captures remain saved; review text manually or
          enable background processing in Settings.
        </p>
      )}
      <label>
        Show captures
        <select
          className="w-full rounded-md border bg-background p-2"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="pending">Pending review</option>
          <option value="parked">Parked thoughts</option>
          <option value="reviewed">Reviewed</option>
          <option value="archived">Archived</option>
          <option value="all">All captures</option>
        </select>
      </label>
      {editor && (
        <form
          className="grid gap-2 rounded-md border p-3"
          aria-label="Review capture suggestion"
          onSubmit={(e) => {
            e.preventDefault();
            void approve();
          }}
        >
          <h3 className="font-semibold">Review before saving</h3>
          <p>Source: “{editor.suggestion.quote}”</p>
          <label>
            Save as
            <select
              className="w-full rounded-md border bg-background p-2"
              aria-label="Save as"
              value={kind}
              onChange={(e) => setKind(e.target.value as Suggestion["kind"])}
            >
              <option value="task">Task in Today planner</option>
              <option value="idea">Idea in Memory Center</option>
              <option value="memory">Memory in Memory Center</option>
            </select>
          </label>
          <label>
            Reviewed text
            <textarea
              className="w-full rounded-md border bg-background p-2 text-base"
              aria-label="Reviewed text"
              value={value}
              maxLength={400}
              onChange={(e) => setValue(scrubChatText(e.target.value))}
            />
          </label>
          {kind === "task" ? (
            <>
              <label>
                Small first step
                <input
                  className="w-full rounded-md border bg-background p-2 text-base"
                  aria-label="Small first step"
                  value={step}
                  maxLength={300}
                  onChange={(e) => setStep(scrubChatText(e.target.value))}
                />
              </label>
              <label>
                Rough minutes (optional)
                <input
                  type="number"
                  min={1}
                  max={180}
                  aria-label="Rough minutes (optional)"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </label>
              <label>
                Materials (optional, one per line)
                <textarea
                  className="w-full rounded-md border bg-background p-2"
                  aria-label="Materials (optional, one per line)"
                  value={materials}
                  onChange={(e) => setMaterials(scrubChatText(e.target.value))}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Memory scope
                <select
                  aria-label="Memory scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="private">Private — explicit chat grants only</option>
                  <option value="global">Global — relevant questions across chats</option>
                  <option value="project">Project — this project only</option>
                </select>
              </label>
              {scope === "project" && (
                <label>
                  Project
                  <select
                    aria-label="Project"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                  >
                    <option value="">Choose project</option>
                    {data?.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p>
                The reviewed text and source quote follow this scope. Private records are excluded
                from Obsidian mirroring.
              </p>
            </>
          )}
          <Button disabled={busy || !value.trim()}>Approve and save</Button>
          {kind === "task" && (
            <Button
              type="button"
              variant="outline"
              disabled={busy || !value.trim()}
              onClick={() => void approve(true)}
            >
              Save and help me start
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => setEditor(null)}>
            Cancel review
          </Button>
        </form>
      )}
      {data?.items
        .filter(
          (c) =>
            filter === "all" ||
            (filter === "parked"
              ? c.inbox!.parked && c.inbox!.status === "pending"
              : filter === "pending"
                ? c.inbox!.status === "pending" && !c.inbox!.parked
                : c.inbox!.status === filter) ||
            c.id === initialId,
        )
        .map((c) => (
          <article key={c.id} className="grid gap-2 rounded-md border p-3" id={"capture-" + c.id}>
            <strong>
              {c.inbox!.source === "audio" ? "Voice memo" : "Thought"} ·{" "}
              {new Date(c.at).toLocaleString()}
            </strong>
            <p className="whitespace-pre-wrap break-words">{c.text}</p>
            {c.inbox!.parked && (
              <p className="text-xs text-muted-foreground">
                Parked{c.inbox!.context?.task ? " while: " + c.inbox!.context.task : " for later"}.
                No automatic task or memory was created.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {c.inbox!.status} · {c.inbox!.job.note}
            </p>
            {c.inbox!.audio && (
              <audio
                controls
                preload="none"
                src={"/api/inbox?audio=" + encodeURIComponent(c.id)}
                className="max-w-full"
              />
            )}
            {c.inbox!.suggestions.map((s) => (
              <div key={s.id} className="rounded-md bg-muted/40 p-2">
                <p>
                  {s.kind}: {s.text}
                </p>
                {c.inbox!.approved.some((a) => a.id === s.id) ? (
                  <span>Saved ✓</span>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => void edit(c, s)}>
                    Review suggestion
                  </Button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              {c.inbox!.status === "pending" && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void mutate({ op: "retry", id: c.id, revision: c.inbox!.revision })
                  }
                >
                  Retry local processing
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void mutate({ op: "archive", id: c.id, revision: c.inbox!.revision })
                }
              >
                Archive capture
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Delete this source capture and any retained audio? Already approved tasks and memories remain in their own managers.",
                    )
                  )
                    void mutate({ op: "delete", id: c.id, revision: c.inbox!.revision });
                }}
              >
                Delete source capture
              </Button>
            </div>
          </article>
        ))}
      {data && (
        <p className="text-muted-foreground">
          {data.items.length} saved captures · capacity {data.limit}. Delete reviewed sources when
          you no longer need them.
        </p>
      )}
    </section>
  );
}
