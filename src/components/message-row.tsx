import { memo } from "react";
import { Copy, GitBranch, ListTodo, Pencil, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { Message, MessageAction, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { agents, agentName, messageText, type Mode, type RoomMessage } from "@/lib/agents";
import { answeredLabel } from "@/lib/engine";
import type { CharacterMode } from "@/lib/hellraiser";
import { replaceEmojiShortcodes } from "@/lib/emoji-shortcodes";
import { extractSteps } from "@/lib/solve-steps";
import { cn } from "@/lib/utils";
import { LinuxActions } from "./linux-actions";
import { PixelCharacter } from "./pixel-character";

/** The things a row can ask the room to do. One object that never changes identity; its methods are refreshed on every render, so a click always runs the latest code. */
export type RowActions = {
  regenerate: (mode: Mode) => void;
  branchFrom: (mode: Mode, id: string) => void;
  editAndRetry: (mode: Mode, id: string) => void;
  addStepsToTasks: (m: RoomMessage) => void;
  speak: (items: { id: string; text: string; agentId: string }[]) => void;
  stopSpeaking: () => void;
};

/**
 * One chat message. It is memoised: while a reply streams or you type, only the rows whose own message (or the few flags below) changed are redrawn,
 * instead of every message in the chat.
 */
export const MessageRow = memo(function MessageRow({ m, wm, characterMode, running, isLast, speaking, canSpeak, desktopApp, act }: {
  m: RoomMessage; wm: Mode; characterMode: CharacterMode; running: boolean; isLast: boolean; speaking: boolean; canSpeak: boolean; desktopApp: boolean; act: RowActions;
}) {
  const a = agents.find((a) => a.id === m.metadata?.agentId);
  const messageMode = m.metadata?.characterMode ?? characterMode;
  const sideTag = m.metadata?.side === "for" ? " · FOR" : m.metadata?.side === "against" ? " · AGAINST" : "";
  const roleTag = m.metadata?.role ? ` · ${String(m.metadata.role).toUpperCase()}` : "";
  const name = a
    ? agentName(a.id, messageMode === "hellraiser", messageMode === "horror", messageMode)
    : "You";
  return (
    <Message
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
          <span>
            {!a
              ? "THE TOPIC"
              : m.metadata?.dm === "dm"
                ? "DUNGEON MASTER"
                : m.metadata?.dm === "party"
                  ? "PARTY"
                  : m.metadata?.verdict
                ? "THE VERDICT"
                : m.metadata?.summary ? "SUMMARY" : m.metadata?.verdict && wm === "debate" ? "THE JUDGE" : m.metadata?.verdict && wm === "broadcast" ? "THE JUDGE" : `ROUND ${m.metadata?.round ?? 1}${sideTag}${roleTag}`}
          </span>
          {m.metadata?.elapsed && (
            <span className="ml-auto">
              {m.role === "assistant" && answeredLabel(m.metadata) ? <span className="mr-2 opacity-70" data-testid="answered-by">{answeredLabel(m.metadata)}</span> : null}
              {m.metadata.elapsed.toFixed(1)}s
            </span>
          )}
        </div>
        <MessageContent className={cn(m.role === "user" && "user-message-content")}>
          {m.parts.map((part, i) =>
            part.type === "text" ? (
              <div key={i}>
                <MessageResponse>{m.role === "assistant" ? replaceEmojiShortcodes(part.text) : part.text}</MessageResponse>
                {m.role === "assistant" && (m.metadata?.assistant ?? (m.metadata?.characterMode === "linux" || m.metadata?.characterMode === "assistant")) && !running && <LinuxActions text={part.text} canRun={desktopApp} />}
              </div>
            ) : part.type === "reasoning" ? (
              <details className="reasoning" key={i}>
                <summary>Thinking</summary>
                <MessageResponse>{part.text}</MessageResponse>
              </details>
            ) : null,
          )}
        </MessageContent>
        {!running && (
          <div className="message-actions">
            {m.role === "assistant" ? (
              <>
                <MessageAction tooltip="Copy reply" label="Copy reply" onClick={() => void navigator.clipboard?.writeText(messageText(m))}>
                  <Copy size={13} />
                </MessageAction>
                {canSpeak && (
                  <MessageAction tooltip={speaking ? "Stop reading" : "Read aloud"} label={speaking ? "Stop reading" : "Read aloud"} onClick={() => { if (speaking) act.stopSpeaking(); else act.speak([{ id: m.id, text: messageText(m), agentId: String(m.metadata?.agentId ?? "echo") }]); }}>
                    {speaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
                  </MessageAction>
                )}
                {isLast && m.metadata?.agentId !== "echo" && (
                  <MessageAction tooltip="Regenerate" label="Regenerate answer" onClick={() => act.regenerate(wm)}>
                    <RefreshCw size={13} />
                  </MessageAction>
                )}
                {wm === "solve" && m.metadata?.verdict && extractSteps(messageText(m)).length > 0 && (
                  <MessageAction tooltip="Add these steps to Tasks" label="Add these steps to Tasks" onClick={() => act.addStepsToTasks(m)}>
                    <ListTodo size={13} />
                  </MessageAction>
                )}
                <MessageAction tooltip="Branch a new chat from here" label="Branch from here" onClick={() => act.branchFrom(wm, m.id)}>
                  <GitBranch size={13} />
                </MessageAction>
              </>
            ) : (
              <MessageAction tooltip="Edit and resend" label="Edit and resend" onClick={() => act.editAndRetry(wm, m.id)}>
                <Pencil size={13} />
              </MessageAction>
            )}
          </div>
        )}
      </div>
    </Message>
  );
});
