import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { DefaultChatTransport, readUIMessageStream } from "ai";
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  Download,
  MessageSquare,
  Wrench,
  Minus,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Settings2,
  Square,
  Users,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { PixelCharacter } from "./pixel-character";
import { ThinkingProp } from "./thinking-prop";
import { characterModeCommand, setCharacterMode, useCharacterMode, type CharacterMode } from "@/lib/hellraiser";
import {
  agents,
  agentName,
  agentPersona,
  models,
  messageText,
  type AgentId,
  type Mode,
  type RoomMessage,
} from "@/lib/agents";
import { SavedDiscussions } from "./saved-discussions";
import matrixRoomImage from "@/assets/matrix-room.jpg";
import fantasyRoomImage from "@/assets/final-fantasy-room.jpg";
import roomImage from "@/assets/pixel-room.jpg";
import devRoomImage from "@/assets/devteam-room.jpg";
import cyberRoomImage from "@/assets/cyberpunk-room.jpg";
import hellRoomImage from "@/assets/hellraiser-room.jpg";
import { streamSpeech } from "@/lib/stream-speech";
import { providerForTurn, useEngine } from "@/lib/engine";
import { hasWebGPU, localTurn, ollamaTurn, speakFree } from "@/lib/local-llm";
import { AutoModelDownload, EngineSettingsDialog, WebGpuUsageBox } from "./engine-settings";
import { OllamaMascot } from "./ollama-mascot";
import { LinuxActions } from "./linux-actions";
import { UpdatePopup } from "./update-popup";
import { linuxContext } from "@/lib/linux";
import { isTauri } from "@/lib/local-llm";
const LinuxTerminal = lazy(() => import("./linux-terminal"));
import { AccountButton } from "./account-button";
import { cn } from "@/lib/utils";

const storageKey = "pixel-pals-conversation-v1";
const suggestions = [
  "What would a city designed by AI look like?",
  "Is creativity uniquely human?",
  "Pitch the next big indie game",
];

export function Room() {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const characterMode = useCharacterMode();
  const [cloud, setCloud] = useState(false);
  const browserMessages = useRef<RoomMessage[]>([]);
  function changeStorage(value: boolean) {
    if (value === cloud) return;
    if (value) browserMessages.current = messages;
    else setMessages(browserMessages.current);
    setCloud(value);
  }
  const engine = useEngine();
  const hell = characterMode === "hellraiser";
  const horror = characterMode === "horror";
  useEffect(() => {
    document.documentElement.classList.toggle("hellraiser", hell);
    document.documentElement.classList.toggle("horror", horror);
    document.documentElement.classList.toggle("matrix", characterMode === "matrix");
    document.documentElement.classList.toggle("finalfantasy", characterMode === "finalfantasy");
    document.documentElement.classList.toggle("devteam", characterMode === "devteam");
    document.documentElement.classList.toggle("cyberpunk", characterMode === "cyberpunk");
    document.documentElement.classList.toggle("linux", characterMode === "linux" || characterMode === "assistant");
  }, [hell, horror, characterMode]);
  const modeRef = useRef(characterMode);
  modeRef.current = characterMode;
  const [ready, setReady] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const voiceRef = useRef(true);
  const toggleVoice = () => {
    voiceRef.current = !voiceRef.current;
    setVoiceOn(voiceRef.current);
  };
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<Mode>("roundtable");
  const [rounds, setRounds] = useState(2);
  const [partner, setPartner] = useState<AgentId>("claude");
  const [enabled, setEnabled] = useState<AgentId[]>(agents.map((a) => a.id));
  const direct = mode === "direct";
  const tooFew = !direct && enabled.length < 2;
  const topicDraft = topic;
  const directMode = direct;
  const partnerChoice = partner;
  const [desktopApp, setDesktopApp] = useState(false);
  useEffect(() => setDesktopApp(isTauri()), []);
  const startRef = useRef<(ask?: { partner: AgentId; text: string }) => Promise<void>>(async () => {});
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<{ partner: AgentId; text: string }>).detail;
      if (detail?.text) void startRef.current(detail);
    };
    window.addEventListener("pixelpals:ask", onAsk);
    return () => window.removeEventListener("pixelpals:ask", onAsk);
  }, []);
  const [selectedModels, setSelectedModels] = useState<Record<AgentId, string>>({
    nova: agents[0].model,
    byte: agents[1].model,
    sage: agents[2].model,
    pip: agents[3].model,
    echo: agents[4].model,
    rune: agents[5].model,
    claude: agents[6].model,
  });
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState<AgentId | null>(null);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [settings, setSettings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const replayRef = useRef<AbortController | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const runLock = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          Array.isArray(parsed) &&
          parsed.every((m) => typeof m.id === "string" && Array.isArray(m.parts))
        )
          setMessages(parsed);
      }
    } catch {
      setSaveError("Your saved conversation could not be opened.");
    }
    setReady(true);
    inputRef.current?.focus();
    return () => {
      abortRef.current?.abort();
      replayRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!ready || cloud) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      setSaveError("Browser storage is full. This conversation could not be saved.");
    }
  }, [messages, ready, cloud]);

  const stop = () => {
    abortRef.current?.abort();
    replayRef.current?.abort();
  };
  async function replay(message: RoomMessage) {
    const agentId = message.metadata?.agentId;
    if (!agentId || running || !messageText(message).trim()) return;
    replayRef.current?.abort();
    if (replayId === message.id) {
      setReplayId(null);
      return;
    }
    const controller = new AbortController();
    replayRef.current = controller;
    setReplayId(message.id);
    setError("");
    try {
      {
        await speakFree(messageText(message), controller.signal);
        return;
      }
      await streamSpeech(
        {
          agentId,
          text: messageText(message),
          characterMode: message.metadata?.characterMode ?? characterMode,
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "Voice playback failed.");
    } finally {
      if (replayRef.current === controller) {
        replayRef.current = null;
        setReplayId(null);
      }
    }
  }
  async function start(ask?: { partner: AgentId; text: string }) {
    if (runLock.current) return;
    replayRef.current?.abort();
    setReplayId(null);
    const topic = ask?.text ?? topicDraft;
    const direct = ask ? true : directMode;
    const partner = ask?.partner ?? partnerChoice;
    const tooFew = !direct && enabled.length < 2;
    const command = ask ? null : characterModeCommand(topic);
    if (command) {
      setCharacterMode(command);
      setTopic("");
      inputRef.current?.focus();
      return;
    }
    if (runLock.current || !topic.trim() || tooFew || !ready) return;
    runLock.current = true;
    setRunning(true);
    setError("");
    setRound(0);
    const controller = new AbortController();
    abortRef.current = controller;
    let transcript: RoomMessage[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: topic.trim() }] },
    ];
    setMessages(transcript);
    setTopic("");
    inputRef.current?.focus();
    try {
      const seated = direct
        ? agents.filter((a) => a.id === partner)
        : agents.filter((a) => enabled.includes(a.id));
      const turns: { agent: (typeof agents)[number]; round: number; verdict: boolean }[] = [];
      for (let r = 1; r <= (direct ? 1 : rounds); r++)
        for (const agent of seated) turns.push({ agent, round: r, verdict: false });
      const lead = seated[0];
      if ((mode === "roundtable" || mode === "solve") && seated.length > 1 && lead)
        turns.push({ agent: lead, round: rounds, verdict: true });
      {
        for (const [turnIndex, { agent, round: currentRound, verdict }] of turns.entries()) {
          setRound(currentRound);
          if (controller.signal.aborted) return;
          setSpeaking(agent.id);
          const began = performance.now();
          // Read the theme live so switching themes mid-discussion applies to the very next speaker.
          const turnMode = modeRef.current;
          const requestBody = {
            agentId: agent.id,
            model: selectedModels[agent.id],
            round: currentRound,
            verdict,
            hellraiser: turnMode === "hellraiser",
            horror: turnMode === "horror",
            characterMode: turnMode,
            mode: direct ? ("direct" as Mode) : mode,
            linuxContext: (turnMode === "linux" || turnMode === "assistant") ? await linuxContext(agent.id) : undefined,
          };
          const fetchPrompt = async () => {
            const res = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...requestBody, messages: transcript, preparePrompt: true }),
              signal: controller.signal,
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Prompt failed.");
            return res.json();
          };
          const runLocal = async () =>
            localTurn(await fetchPrompt(), { agentId: agent.id, round: currentRound }, controller.signal);
          const runCloud = (provider: NonNullable<ReturnType<typeof providerForTurn>>) =>
            new DefaultChatTransport<RoomMessage>({ api: "/api/chat", body: { ...requestBody, engine: provider } }).sendMessages({
              chatId: "pixel-pals-room",
              messageId: undefined,
              messages: transcript,
              trigger: "submit-message",
              abortSignal: controller.signal,
            });
          let answer: RoomMessage | undefined;
          const answerId = crypto.randomUUID();
          const consume = async (stream: Awaited<ReturnType<typeof runLocal>>) => {
            for await (const partial of readUIMessageStream<RoomMessage>({ stream, terminateOnError: true })) {
              answer = {
                ...partial,
                id: answerId,
                metadata: {
                  ...partial.metadata,
                  agentId: agent.id,
                  characterMode: turnMode,
                  round: currentRound,
                  ...(verdict ? { verdict: true } : {}),
                  elapsed: (performance.now() - began) / 1000,
                },
              };
              setMessages([...transcript, answer]);
            }
          };
          const provider = providerForTurn(engine, turnIndex);
          if (engine.kind === "ollama") {
            await consume(
              await ollamaTurn(
                await fetchPrompt(),
                { url: engine.ollamaUrl, model: engine.ollamaModel },
                { agentId: agent.id, round: currentRound },
                controller.signal,
              ),
            );
          } else if (engine.kind === "local" || (engine.kind === "auto" && !provider)) {
            await consume(await runLocal());
          } else if (!provider) {
            throw new Error("Add at least one free key in AI engine settings (Groq, Gemini or OpenRouter), or choose In-browser.");
          } else if (engine.kind === "auto") {
            // Auto: free keys are far faster; the in-browser model takes over when a key hits its limit.
            try {
              await consume(await runCloud(provider));
            } catch (err) {
              if (controller.signal.aborted || !hasWebGPU() || (answer && messageText(answer).trim())) throw err;
              answer = undefined;
              await consume(await runLocal());
            }
          } else {
            await consume(await runCloud(provider));
          }
          if (answer && messageText(answer).trim()) {
            transcript = [...transcript, answer];
            setMessages(transcript);
            if (turnMode === "hellraiser" && voiceRef.current && !controller.signal.aborted) {
              try {
                await speakFree(messageText(answer), controller.signal);
              } catch (err) {
                if (controller.signal.aborted) return;
                voiceRef.current = false;
                setVoiceOn(false);
                setError(
                  `${err instanceof Error ? err.message : "Voice failed."} Voices are muted; the discussion continues.`,
                );
              }
            }
          } else if (!controller.signal.aborted)
            throw new Error("This agent returned no answer. The discussion has stopped.");
        }
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "The discussion could not continue.");
    } finally {
      setRunning(false);
      setSpeaking(null);
      runLock.current = false;
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }
  startRef.current = start;
  function exportChat() {
    const text = messages
      .map(
        (m) =>
          `### ${m.metadata?.agentId ? agentName(m.metadata?.agentId, m.metadata?.characterMode === "hellraiser", m.metadata?.characterMode === "horror", m.metadata?.characterMode ?? characterMode) : "You"}\n\n${messageText(m)}`,
      )
      .join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "pixel-pals-chat.md";
    link.click();
    URL.revokeObjectURL(url);
  }
  const activeAgent = agents.find((a) => a.id === speaking);
  const lastMessage = messages[messages.length - 1];
  const liveText =
    running && lastMessage?.metadata?.agentId === speaking ? messageText(lastMessage).trim() : "";
  const bubbleText = liveText.length > 70 ? `…${liveText.slice(-70)}` : liveText;
  return (
    <div className="app-shell">
      <header className="app-header">
        <a href="/" className="brand">
          <span className="brand-icon">
            <PixelCharacter id="nova" />
          </span>
          <span>
            pixel<span className="text-primary">pals</span>
            <span className="brand-chat"> / chat</span>
          </span>
        </a>
        <div className="header-right">
          <span className="lab-badge">
            <span className="status-dot" /> THE MULTI-MODEL PLAYGROUND
          </span>
          <EngineSettingsDialog />
          <AccountButton theme={characterMode} onTheme={setCharacterMode} />
          <Select
            value={characterMode}
            disabled={running}
            onValueChange={(value) => setCharacterMode(value as CharacterMode)}
          >
            <SelectTrigger aria-label="Theme" className="theme-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal Mode</SelectItem>
              <SelectItem value="hellraiser">Hellraiser Mode</SelectItem>
              <SelectItem value="horror">Horror Mode</SelectItem>
              <SelectItem value="matrix">Matrix Theme</SelectItem>
              <SelectItem value="finalfantasy">Final Fantasy Theme</SelectItem>
              <SelectItem value="devteam">Dev Team Theme</SelectItem>
              <SelectItem value="cyberpunk">Cyberpunk Theme</SelectItem>
              <SelectItem value="linux">Linux Mode</SelectItem>              <SelectItem value="assistant">Assistant Mode</SelectItem>
            </SelectContent>
          </Select>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="About this room">
                <CircleHelp />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>A little room for big ideas</DialogTitle>
                <DialogDescription>
                  Roundtable lets the pals respond to each other. Broadcast gives independent
                  answers. Choose at least two pals, set your topic, and start. Your conversation is
                  saved only in this browser. Choose Saved discussions to keep and reopen multiple conversations. AI replies use your free keys or the in-browser model — no credits.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <main className="workspace">
        <section className="room-column">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {characterMode === "assistant" ? "ASSISTANT MODE" : characterMode === "linux" ? "LINUX MODE" : characterMode === "cyberpunk" ? "NEON NETRUNNERS" : characterMode === "devteam" ? "ENGINEERING STANDUP" : characterMode === "matrix" ? "THE MATRIX" : characterMode === "finalfantasy" ? "FINAL FANTASY" : horror
                  ? "HORROR MODE"
                  : hell
                    ? "THE LAMENT CONFIGURATION IS SOLVED"
                    : "YOUR AI COMMON ROOM"}
              </div>
              <h1>
                {characterMode === "linux" || characterMode === "assistant" ? "Seven assistants." : characterMode === "cyberpunk" ? "Seven netrunners." : characterMode === "devteam" ? "Seven engineers." : characterMode === "matrix" ? "Free your mind." : characterMode === "finalfantasy" ? "Seven heroes." : horror ? "Horror icons." : hell ? "We have such sights" : "A little room."}
                <br />
                {characterMode === "assistant" ? "One helpful crew" : characterMode === "linux" ? "One penguin" : characterMode === "cyberpunk" ? "One neon grid" : characterMode === "devteam" ? "One codebase" : characterMode === "matrix" ? "Question everything" : characterMode === "finalfantasy" ? "One shared quest" : horror ? "One dark room" : hell ? "to show you" : "Big ideas"}
                <span className="text-primary">.</span>
              </h1>
              <p>
                {characterMode === "assistant" ? "Mail, tasks, calendar, notes, files and system — all in one chat." : characterMode === "linux" ? "Mail, tasks, calendar, notes, files, system — and Tux in your terminal." : characterMode === "cyberpunk" ? "Jacked in under the rain, cracking the problem together." : characterMode === "devteam" ? "Everyone at their desk, shipping the best fix together." : characterMode === "matrix" ? "The crew is connected. Beyond the code, new possibilities." : characterMode === "finalfantasy" ? "From seven different worlds, a party comes together." : horror
                  ? "The masks are on. The conversation begins."
                  : hell
                    ? "The Cenobites answer your call. Type “Normal mode” to close the box."
                    : "Different minds. One conversation. Type “Hellraiser mode” if you dare."}
              </p>
            </div>
            <span className="room-number">
              ROOM
              <br />
              <b>001</b>
            </span>
          </div>
          {(engine.kind === "local" || engine.kind === "auto") && <><AutoModelDownload /><WebGpuUsageBox active /></>}
          <OllamaMascot active={running && engine.kind === "ollama"} />
          <UpdatePopup />
          {characterMode === "linux" && (desktopApp ? (
            <Suspense fallback={<div className="linux-terminal">Opening terminal…</div>}><LinuxTerminal /></Suspense>
          ) : (
            <p className="linux-note">Tux's terminal, notes, files and system stats work in the Pixel Pals desktop app. Here, pals can still help and give you commands to copy.</p>
          ))}
          <div className="room-scene">
            <img
              src={characterMode === "cyberpunk" ? cyberRoomImage : characterMode === "devteam" || characterMode === "linux" || characterMode === "assistant" ? devRoomImage : characterMode === "matrix" ? matrixRoomImage : characterMode === "finalfantasy" ? fantasyRoomImage : hell ? hellRoomImage : roomImage}
              className={cn("pixel-room-image", hell && "hell-room-image")}
              width={1536}
              height={864}
              alt={
                characterMode === "cyberpunk" ? "Neon-lit cyberpunk hacker den with holographic terminals" : characterMode === "devteam" || characterMode === "linux" || characterMode === "assistant" ? "Pixel-art software office with seven computer desks" : characterMode === "matrix" ? "Matrix hacker room with green code terminals and a discussion table" : characterMode === "finalfantasy" ? "Final Fantasy airship room with a glowing crystal and round table" : hell
                  ? "Pixel-art Cenobite chamber with chains, candles and a glowing puzzle box"
                  : "Pixel-art common room with a discussion table, computer stations, and plants"
              }
            />
            {hell && <div className="hell-glow" aria-hidden />}
            <div className="scene-top">
              <span>
                <span className={cn("status-dot", running && "pulse-dot")} />
                {running ? "CONVERSATION IN PROGRESS" : "WAITING FOR A GOOD IDEA"}
              </span>
              <span className="flex items-center gap-2">
                {hell && (
                  <button
                    type="button"
                    className="voice-toggle"
                    onClick={toggleVoice}
                    aria-pressed={voiceOn}
                    aria-label={voiceOn ? "Mute Cenobite voices" : "Unmute Cenobite voices"}
                  >
                    {voiceOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
                    {voiceOn ? "VOICES ON" : "VOICES OFF"}
                  </button>
                )}
                {enabled.length} PALS IN ROOM
              </span>
            </div>
            {agents.map((a, i) => (
              <div
                key={a.id}
                className={cn(
                  "scene-pal",
                  `scene-pal-${i}`,
                  !enabled.includes(a.id) && "pal-away",
                  speaking === a.id && "is-speaking",
                  running && speaking && speaking !== a.id && enabled.includes(a.id) && "is-listening",
                )}
              >
                {speaking === a.id && (
                  <div className={`speech-bubble agent-${a.id}`} aria-hidden="true">
                    {bubbleText || "···"}
                  </div>
                )}
                {speaking === a.id && !bubbleText && <ThinkingProp id={a.id} mode={characterMode} />}
                <PixelCharacter id={a.id} animated={speaking === a.id} />
                <span className={`agent-${a.id}`}>
                  {agentName(a.id, hell, horror, characterMode)}
                  {speaking === a.id && " ···"}
                </span>
              </div>
            ))}
            <div className="scene-bottom">
              <span>
                <Users size={13} /> {mode === "roundtable" ? "Roundtable" : direct ? "One-on-one" : mode === "solve" ? "Problem solving" : "Broadcast"}
              </span>
              <span>
                {running ? (direct ? "Chatting" : `Round ${round} of ${rounds}`) : "Ready when you are"}
                <span className="scene-cursor">_</span>
              </span>
            </div>
          </div>
          <div className="section-heading">
            <h2>
              The pals <span>{enabled.length}/{agents.length}</span>
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setSettings(!settings)}>
              <Settings2 size={14} />
              {settings ? "Hide settings" : "Model settings"}
            </Button>
          </div>
          <div className="agent-grid">
            {agents.map((a) => (
              <div
                key={a.id}
                className={cn(
                  "agent-card",
                  `agent-${a.id}`,
                  !enabled.includes(a.id) && "agent-disabled",
                )}
              >
                <div className="agent-card-top">
                  <span className="avatar-tile">
                    <PixelCharacter id={a.id} />
                  </span>
                  <Switch
                    aria-label={`Enable ${agentName(a.id, hell, horror, characterMode)}`}
                    checked={enabled.includes(a.id)}
                    disabled={running}
                    onCheckedChange={(checked) =>
                      setEnabled((prev) =>
                        checked ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                      )
                    }
                  />
                </div>
                <h3>
                  {agentName(a.id, hell, horror, characterMode)}
                  <span className="agent-dot" />
                </h3>
                <p>{agentPersona(a.id, hell, horror, characterMode).role}</p>
                <span className="model-label">
                  {models.find((m) => m.id === selectedModels[a.id])?.label}
                </span>
                {settings && (
                  <Select
                    value={selectedModels[a.id]}
                    disabled={running}
                    onValueChange={(value) =>
                      setSelectedModels((prev) => ({ ...prev, [a.id]: value }))
                    }
                  >
                    <SelectTrigger
                      aria-label={`${agentName(a.id, hell, horror, characterMode)} model`}
                      className="mt-3"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ))}
          </div>
          <div className="topic-section">
            <div className="section-heading">
              <h2>What's on your mind?</h2>
              <span className="muted-label">YOU SET THE TOPIC</span>
            </div>
            <PromptInput onSubmit={() => start()} className="topic-composer">
              <PromptInputTextarea
                ref={inputRef}
                aria-label="Discussion topic"
                placeholder="Give your pals something to talk about…"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="min-h-24"
                disabled={running}
              />
              <PromptInputFooter>
                <span className="composer-label">
                  <MessageSquare size={13} /> A question, an idea, a rabbit hole.
                </span>
                <PromptInputSubmit
                  aria-label={running ? "Stop discussion" : "Start topic"}
                  status={running ? "streaming" : "ready"}
                  onStop={stop}
                  disabled={
                    !running &&
                    (!topic.trim() ||
                      (!characterModeCommand(topic) && tooFew) ||
                      !ready)
                  }
                />
              </PromptInputFooter>
            </PromptInput>
            <div className="suggestions">
              {suggestions.map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  size="sm"
                  disabled={running}
                  onClick={() => {
                    setTopic(s);
                    inputRef.current?.focus();
                  }}
                >
                  {s}
                  <ArrowUpRight size={12} />
                </Button>
              ))}
            </div>
          </div>
          <div className="launch-controls">
            <div>
              <span className="control-label">CONVERSATION MODE</span>
              <div className="mode-switch">
                <Button
                  variant="ghost"
                  disabled={running}
                  aria-pressed={mode === "roundtable"}
                  className={cn(mode === "roundtable" && "mode-active")}
                  onClick={() => setMode("roundtable")}
                >
                  <Users />
                  Roundtable
                </Button>
                <Button
                  variant="ghost"
                  disabled={running}
                  aria-pressed={mode === "broadcast"}
                  className={cn(mode === "broadcast" && "mode-active")}
                  onClick={() => setMode("broadcast")}
                >
                  <Radio />
                  Broadcast
                </Button>
                <Button
                  variant="ghost"
                  disabled={running}
                  aria-pressed={direct}
                  className={cn(direct && "mode-active")}
                  onClick={() => setMode("direct")}
                >
                  <MessageSquare />
                  One-on-one
                </Button>
                <Button
                  variant="ghost"
                  disabled={running}
                  aria-pressed={mode === "solve"}
                  className={cn(mode === "solve" && "mode-active")}
                  onClick={() => setMode("solve")}
                >
                  <Wrench />
                  Problem solving
                </Button>
              </div>
            </div>
            {direct && (
              <div>
                <span className="control-label">TALK WITH</span>
                <select
                  className="partner-select"
                  aria-label="Pal to talk with"
                  value={partner}
                  disabled={running}
                  onChange={(e) => setPartner(e.target.value as AgentId)}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {agentName(a.id, hell, horror, characterMode)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!direct && (
            <div>
              <span className="control-label">ROUNDS</span>
              <div className="round-stepper">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Fewer rounds"
                  disabled={running || rounds <= 1}
                  onClick={() => setRounds(rounds - 1)}
                >
                  <Minus />
                </Button>
                <span>{rounds}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More rounds"
                  disabled={running || rounds >= 5}
                  onClick={() => setRounds(rounds + 1)}
                >
                  <Plus />
                </Button>
              </div>
            </div>
            )}
            <Button
              className="start-button"
              onClick={running ? stop : () => void start()}
              disabled={
                !running &&
                (!topic.trim() || (!characterModeCommand(topic) && tooFew) || !ready)
              }
            >
              {running ? <Square /> : <Play fill="currentColor" />}
              {running ? "Stop" : direct ? "Send" : "Start discussion"}
            </Button>
          </div>
          {tooFew && (
            <p className="validation-note">Invite at least two pals to start a discussion.</p>
          )}
        </section>
        <section className="conversation-panel">
          <div className="conversation-header">
            <h2>
              <MessageSquare size={18} />
              The conversation
              <span className="message-count">
                {messages.filter((m) => m.role === "assistant").length}
              </span>
            </h2>
            <div>
              <Button
                variant="ghost"
                size="icon"
                title="Download conversation"
                aria-label="Download conversation"
                onClick={exportChat}
                disabled={!messages.length}
              >
                <Download />
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Clear conversation"
                    aria-label="Clear conversation"
                    disabled={running || !messages.length}
                  >
                    <RotateCcw />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear this conversation?</DialogTitle>
                    <DialogDescription>
                      This clears the current chat. Previously saved discussions stay until you delete them. Download a copy first if you want to
                      keep it.
                    </DialogDescription>
                  </DialogHeader>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setMessages([]);
                      setRound(0);
                      setError("");
                    }}
                  >
                    Clear conversation
                  </Button>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <SavedDiscussions key={cloud ? "cloud" : "browser"} messages={messages} mode={mode} theme={characterMode} running={running} cloud={cloud} onCloud={changeStorage} onOpen={(items, theme, discussionMode) => { setMessages(items); setCharacterMode(theme); setMode(discussionMode); setRound(0); setError(""); }} />
          <div className="conversation-subhead">
            <span className="status-dot" />
            {running
              ? `${activeAgent ? agentName(activeAgent.id, hell, horror, characterMode) : horror ? "The icons" : hell ? "The Order" : "Your pals"} is thinking…`
              : messages.length
                ? "The floor is yours"
                : "The room is open"}
            <span>{mode === "roundtable" ? "ROUND TABLE" : direct ? "ONE-ON-ONE" : mode === "solve" ? "PROBLEM SOLVING" : "BROADCAST"}</span>
          </div>
          <Conversation className="chat-log">
            <ConversationContent
              className={cn("chat-content", !messages.length && "empty-content")}
            >
              {!messages.length ? (
                <div className="chat-empty">
                  <div className="empty-pals">
                    <PixelCharacter id="byte" />
                    <PixelCharacter id="nova" />
                    <PixelCharacter id="sage" />
                  </div>
                  <div className="pixel-speech">···</div>
                  <h3>
                    Good conversations
                    <br />
                    start with a little curiosity.
                  </h3>
                  <p>
                    Your pals are all here.
                    <br />
                    What should they talk about?
                  </p>
                  <span className="empty-divider" />
                  <span className="empty-caption">FOUR PERSONALITIES. ENDLESS POSSIBILITIES.</span>
                </div>
              ) : (
                messages.map((m) => {
                  const a = agents.find((a) => a.id === m.metadata?.agentId);
                  const messageMode = m.metadata?.characterMode ?? characterMode;
                  const name = a
                    ? agentName(a.id, messageMode === "hellraiser", messageMode === "horror", messageMode)
                    : "You";
                  return (
                    <Message
                      key={m.id}
                      from={m.role}
                      className={cn("room-message", m.metadata?.verdict && "verdict-message")}
                    >
                      {a && (
                        <div className={`message-avatar agent-${a.id}`}>
                          <PixelCharacter id={a.id} mode={messageMode} />
                        </div>
                      )}
                      <div className="message-main">
                        <div className="message-heading">
                          <b className={a ? `agent-${a.id}` : "text-primary"}>{name}</b>
                          {a && m.role === "assistant" && (
                            <MessageAction
                              className="reply-voice"
                              tooltip={
                                replayId === m.id
                                  ? "Stop voice playback"
                                  : `Hear ${name} read this reply`
                              }
                              aria-label={
                                replayId === m.id
                                  ? "Stop voice playback"
                                  : `Hear ${name} read this reply`
                              }
                              aria-pressed={replayId === m.id}
                              disabled={running || !messageText(m).trim()}
                              onClick={() => void replay(m)}
                            >
                              {replayId === m.id ? <Square size={13} /> : <Volume2 size={14} />}
                            </MessageAction>
                          )}
                          <span>
                            {!a
                              ? "THE TOPIC"
                              : m.metadata?.verdict
                                ? "THE VERDICT"
                                : `ROUND ${m.metadata?.round ?? 1}`}
                          </span>
                          {m.metadata?.elapsed && (
                            <span className="ml-auto">{m.metadata.elapsed.toFixed(1)}s</span>
                          )}
                        </div>
                        <MessageContent className={cn(m.role === "user" && "user-message-content")}>
                          {m.parts.map((part, i) =>
                            part.type === "text" ? (
                              <div key={i}>
                                <MessageResponse>{part.text}</MessageResponse>
                                {m.role === "assistant" && (m.metadata?.characterMode === "linux" || m.metadata?.characterMode === "assistant") && !running && <LinuxActions text={part.text} canRun={m.metadata?.characterMode === "linux"} />}
                              </div>
                            ) : part.type === "reasoning" ? (
                              <details className="reasoning" key={i}>
                                <summary>Thinking</summary>
                                <MessageResponse>{part.text}</MessageResponse>
                              </details>
                            ) : null,
                          )}
                        </MessageContent>
                      </div>
                    </Message>
                  );
                })
              )}
              {running && (
                <div className="thinking-row">
                  {speaking && <PixelCharacter id={speaking} animated />}
                  <Shimmer>{`${activeAgent ? agentName(activeAgent.id, hell, horror, characterMode) : horror ? "The icons" : hell ? "The Order" : "Your pals"} is thinking…`}</Shimmer>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          {(error || saveError) && (
            <div className="chat-error" role="alert">
              {error || saveError}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Dismiss error"
                onClick={() => {
                  setError("");
                  setSaveError("");
                }}
              >
                <X />
              </Button>
            </div>
          )}
          <footer className="conversation-footer">
            <span>
              <span className="status-dot" />
              {running
                ? `ROUND ${round} / ${rounds}`
                : round
                  ? `${round} ROUND${round > 1 ? "S" : ""} COMPLETE`
                  : "READY TO START"}
            </span>
            <span>
              <Check size={12} /> {cloud ? "SAVED DISCUSSIONS · PRESS SAVE TO KEEP CHANGES" : "SAVED IN THIS BROWSER"}
            </span>
          </footer>
        </section>
      </main>
      <footer className="app-footer">
        <span>SMALL PIXELS. BIG PERSPECTIVES.</span>
        <span>
          Made for a meeting of minds <span className="text-primary">✳</span>
        </span>
      </footer>
    </div>
  );
}
