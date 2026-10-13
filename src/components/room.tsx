import { useEffect, useRef, useState } from "react";
import { DefaultChatTransport, readUIMessageStream } from "ai";
import {
  ArrowUpRight,
  Check,
  CircleHelp,
  Download,
  MessageSquare,
  Minus,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Settings2,
  Square,
  Users,
  X,
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
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { PixelCharacter } from "./pixel-character";
import { characterModeCommand, setCharacterMode, useCharacterMode } from "@/lib/hellraiser";
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
import roomImage from "@/assets/pixel-room.jpg";
import hellRoomImage from "@/assets/hellraiser-room.jpg";
import { streamSpeech } from "@/lib/stream-speech";
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
  const hell = characterMode === "hellraiser";
  const horror = characterMode === "horror";
  useEffect(() => {
    document.documentElement.classList.toggle("hellraiser", hell);
    document.documentElement.classList.toggle("horror", horror);
  }, [hell, horror]);
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
  const [enabled, setEnabled] = useState<AgentId[]>(agents.map((a) => a.id));
  const [selectedModels, setSelectedModels] = useState<Record<AgentId, string>>({
    nova: agents[0].model,
    byte: agents[1].model,
    sage: agents[2].model,
    pip: agents[3].model,
  });
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState<AgentId | null>(null);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [settings, setSettings] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
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
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      setSaveError("Browser storage is full. This conversation could not be saved.");
    }
  }, [messages, ready]);

  const stop = () => {
    abortRef.current?.abort();
  };
  async function start() {
    if (runLock.current) return;
    const command = characterModeCommand(topic);
    if (command) {
      setCharacterMode(command);
      setTopic("");
      inputRef.current?.focus();
      return;
    }
    if (runLock.current || !topic.trim() || enabled.length < 2 || !ready) return;
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
      for (let currentRound = 1; currentRound <= rounds; currentRound++) {
        setRound(currentRound);
        for (const agent of agents.filter((a) => enabled.includes(a.id))) {
          if (controller.signal.aborted) return;
          setSpeaking(agent.id);
          const began = performance.now();
          const transport = new DefaultChatTransport<RoomMessage>({
            api: "/api/chat",
            body: { agentId: agent.id, model: selectedModels[agent.id], mode, round: currentRound, hellraiser: hell, horror },
          });
          const stream = await transport.sendMessages({
            chatId: "pixel-pals-room",
            messageId: undefined,
            messages: transcript,
            trigger: "submit-message",
            abortSignal: controller.signal,
          });
          let answer: RoomMessage | undefined;
          for await (const partial of readUIMessageStream<RoomMessage>({
            stream,
            terminateOnError: true,
          })) {
            answer = {
              ...partial,
              metadata: {
                ...partial.metadata,
                agentId: agent.id,
                round: currentRound,
                elapsed: (performance.now() - began) / 1000,
              },
            };
            setMessages([...transcript, answer]);
          }
          if (answer && messageText(answer).trim()) {
            transcript = [...transcript, answer];
            setMessages(transcript);
            if (hell && voiceRef.current && !controller.signal.aborted) {
              try {
                await streamSpeech({ agentId: agent.id, text: messageText(answer) }, controller.signal);
              } catch (err) {
                if (controller.signal.aborted) return;
                voiceRef.current = false;
                setVoiceOn(false);
                setError(`${err instanceof Error ? err.message : "Voice failed."} Voices are muted; the discussion continues.`);
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
  function exportChat() {
    const text = messages
      .map(
        (m) =>
          `### ${m.metadata?.agentId ? agentName(m.metadata?.agentId, hell, horror) : "You"}\n\n${messageText(m)}`,
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
                  saved only in this browser. AI replies use workspace AI credits.
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
              <div className="eyebrow">{horror ? "HORROR MODE" : hell ? "THE LAMENT CONFIGURATION IS SOLVED" : "YOUR AI COMMON ROOM"}</div>
              <h1>
                {horror ? "Horror icons." : hell ? "We have such sights" : "A little room."}
                <br />
                {horror ? "One dark room" : hell ? "to show you" : "Big ideas"}
                <span className="text-primary">.</span>
              </h1>
              <p>
                {horror
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
          <div className="room-scene">
            <img
              src={hell ? hellRoomImage : roomImage}
              className={cn("pixel-room-image", hell && "hell-room-image")}
              width={1536}
              height={864}
              alt={hell ? "Pixel-art Cenobite chamber with chains, candles and a glowing puzzle box" : "Pixel-art common room with a discussion table, computer stations, and plants"}
            />
            {hell && <div className="hell-glow" aria-hidden />}
            <div className="scene-top">
              <span>
                <span className={cn("status-dot", running && "pulse-dot")} />
                {running ? "CONVERSATION IN PROGRESS" : "WAITING FOR A GOOD IDEA"}
              </span>
              <span>{enabled.length} PALS IN ROOM</span>
            </div>
            {agents.map((a, i) => (
              <div
                key={a.id}
                className={cn(
                  "scene-pal",
                  `scene-pal-${i}`,
                  !enabled.includes(a.id) && "pal-away",
                  speaking === a.id && "is-speaking",
                )}
              >
                <PixelCharacter id={a.id} animated={speaking === a.id} />
                <span className={`agent-${a.id}`}>
                  {agentName(a.id, hell, horror)}
                  {speaking === a.id && " ···"}
                </span>
              </div>
            ))}
            <div className="scene-bottom">
              <span>
                <Users size={13} /> {mode === "roundtable" ? "Roundtable" : "Broadcast"}
              </span>
              <span>
                {running ? `Round ${round} of ${rounds}` : "Ready when you are"}
                <span className="scene-cursor">_</span>
              </span>
            </div>
          </div>
          <div className="section-heading">
            <h2>
              The pals <span>{enabled.length}/4</span>
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
                    aria-label={`Enable ${agentName(a.id, hell, horror)}`}
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
                  {agentName(a.id, hell, horror)}
                  <span className="agent-dot" />
                </h3>
                <p>{agentPersona(a.id, hell, horror).role}</p>
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
                    <SelectTrigger aria-label={`${agentName(a.id, hell, horror)} model`} className="mt-3">
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
                  disabled={!running && (!topic.trim() || (!characterModeCommand(topic) && enabled.length < 2) || !ready)}
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
              </div>
            </div>
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
            <Button
              className="start-button"
              onClick={running ? stop : start}
              disabled={!running && (!topic.trim() || (!characterModeCommand(topic) && enabled.length < 2) || !ready)}
            >
              {running ? <Square /> : <Play fill="currentColor" />}
              {running ? "Stop discussion" : "Start discussion"}
            </Button>
          </div>
          {enabled.length < 2 && (
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
                      This removes the chat from this browser. Download a copy first if you want to
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
          <div className="conversation-subhead">
            <span className="status-dot" />
            {running
              ? `${activeAgent ? agentName(activeAgent.id, hell, horror) : horror ? "The icons" : hell ? "The Order" : "Your pals"} is thinking…`
              : messages.length
                ? "The floor is yours"
                : "The room is open"}
            <span>{mode === "roundtable" ? "ROUND TABLE" : "BROADCAST"}</span>
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
                  return (
                    <Message key={m.id} from={m.role} className="room-message">
                      {a && (
                        <div className={`message-avatar agent-${a.id}`}>
                          <PixelCharacter id={a.id} />
                        </div>
                      )}
                      <div className="message-main">
                        <div className="message-heading">
                          <b className={a ? `agent-${a.id}` : "text-primary"}>{a ? agentName(a.id, hell, horror) : "You"}</b>
                          <span>{a ? `ROUND ${m.metadata?.round ?? 1}` : "THE TOPIC"}</span>
                          {m.metadata?.elapsed && (
                            <span className="ml-auto">{m.metadata.elapsed.toFixed(1)}s</span>
                          )}
                        </div>
                        <MessageContent className={cn(m.role === "user" && "user-message-content")}>
                          {m.parts.map((part, i) =>
                            part.type === "text" ? (
                              <MessageResponse key={i}>{part.text}</MessageResponse>
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
                  <Shimmer>{`${activeAgent ? agentName(activeAgent.id, hell, horror) : horror ? "The icons" : hell ? "The Order" : "Your pals"} is thinking…`}</Shimmer>
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
              <Check size={12} /> SAVED IN THIS BROWSER
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
