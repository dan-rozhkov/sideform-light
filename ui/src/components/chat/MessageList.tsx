import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import type { UIMessage } from "ai";
import { isToolUIPart } from "ai";
import {
  ImageBrokenIcon,
  ArrowCounterClockwiseIcon,
  CopyIcon,
  CheckIcon,
  SparkleIcon,
} from "@/components/icons";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import { messageToClipboardText } from "@/lib/chatExport";
import { IconSwap } from "@/components/ui/IconSwap";
import type { AskUserInput } from "@/types/askUser";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { SimpleMarkdown } from "./SimpleMarkdown";
import { ToolCallIndicator } from "./ToolCallIndicator";
import { BrowseAgentIndicator } from "./BrowseAgentIndicator";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ImageLightbox } from "./ImageLightbox";
import { AskUserForm } from "./AskUserForm";
import { useT } from "@/i18n";
import { ScheduleConfirmCard } from "./ScheduleConfirmCard";
import { ScheduleActionCard } from "./ScheduleActionCard";
import { pendingScheduleActions, usePendingScheduleActionsVersion } from "@/lib/tools/pendingScheduleActions";
import { isScheduleActionTool, parseScheduleActionInput, parseScheduleCreateInput, type ScheduleActionTool } from "@/lib/tools/schedules";
import { MemoryActivityRow } from "./MemoryActivityRow";
import { isMemoryWriteSuccessful, memoryChangesFromInput, noteChangeList } from "@/lib/memoryActivity";
import type { ChatActivityNote } from "@/store/chatStore";
import { isPendingScheduleActionPart, isPendingScheduleCreatePart } from "./pendingScheduleCreate";

interface ImagePreviewProps {
  url: string;
  alt?: string;
  /** Full group of image urls this thumbnail belongs to. Defaults to [url]. */
  urls?: string[];
  /** Index of this thumbnail within the group. Defaults to 0. */
  index?: number;
}

export function ImagePreview({ url, alt, urls, index = 0 }: ImagePreviewProps) {
  const group = urls && urls.length > 0 ? urls : [url];
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const t = useT();
  return (
    <>
      {failed ? (
        <div className="w-[60px] h-[120px] rounded-md bg-surface-panel text-text-muted flex items-center justify-center">
          <ImageBrokenIcon size={18} />
        </div>
      ) : (
        <img
          src={url}
          alt={alt ?? t("chat.attachedImage")}
          onClick={() => setLightboxIndex(index)}
          onError={() => setFailed(true)}
          className="max-w-[120px] max-h-[120px] rounded-md cursor-pointer hover:opacity-80 transition-opacity object-cover img-outline"
        />
      )}
      {lightboxIndex !== null && (
        <ImageLightbox
          urls={group}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}

function MessageCopyButton({ msg }: { msg: UIMessage }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => () => clearTimeout(resetTimeoutRef.current), []);

  const text = messageToClipboardText(msg);

  // Nothing to copy (tool-only turn, image-only message): no button, so the
  // clipboard is never overwritten with an empty string.
  if (!text) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard write can fail without permission; ignore silently.
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-control-sm hover:bg-secondary text-text-muted transition-colors"
            aria-label={copied ? t("common.copied") : t("chat.copyMessage")}
          >
            <IconSwap
              active={copied}
              activeIcon={<CheckIcon size={14} />}
              inactiveIcon={<CopyIcon size={14} />}
            />
          </button>
        }
      />
      <TooltipContent>{copied ? t("common.copied") : t("chat.copyMessage")}</TooltipContent>
    </Tooltip>
  );
}

function StreamingIndicator() {
  return (
    <div className="h-5 flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full bg-text-muted animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  onRollback?: (messageId: string) => void;
  addToolOutput?: (o: { tool: string; toolCallId: string; output: string }) => void;
  /** Whether this transcript is actually on screen. The mobile Agents panel
   * now stays mounted (`display: none`) rather than unmounting when closed
   * (so the chat stream survives close/reopen), which collapses the scroll
   * box and resets `scrollTop` to 0. Defaults to true for callers that are
   * always visible. */
  isVisible?: boolean;
  /** UI-only rows for background-review memory writes, each rendered under the assistant message it is anchored to. */
  activityNotes?: ChatActivityNote[];
}

/** Maps message id -> notes rendered under it. `afterMessageId` anchors directly; `turnMessageId` resolves to the
 * last assistant message between that user message and the next user message (nothing if absent). */
function groupNotesByMessage(messages: UIMessage[], notes: ChatActivityNote[] | undefined): Map<string, ChatActivityNote[]> {
  const out = new Map<string, ChatActivityNote[]>();
  if (!notes?.length) return out;
  const add = (messageId: string, n: ChatActivityNote) => {
    const list = out.get(messageId);
    if (list) list.push(n);
    else out.set(messageId, [n]);
  };
  for (const n of notes) {
    if (n.afterMessageId !== undefined) {
      add(n.afterMessageId, n);
      continue;
    }
    const start = messages.findIndex((m) => m.id === n.turnMessageId && m.role === "user");
    if (start === -1) continue;
    let target: string | undefined;
    for (let i = start + 1; i < messages.length; i++) {
      if (messages[i].role === "user") break;
      if (messages[i].role === "assistant") target = messages[i].id;
    }
    if (target !== undefined) add(target, n);
  }
  return out;
}

export function MessageList({
  messages,
  isLoading,
  onRollback,
  addToolOutput,
  isVisible = true,
  activityNotes,
}: MessageListProps) {
  const t = useT();
  const notesByMessage = useMemo(() => groupNotesByMessage(messages, activityNotes), [messages, activityNotes]);
  usePendingScheduleActionsVersion(); // a card appears when the precheck records its schedule
  const containerRef = useRef<HTMLDivElement>(null);
  const isAutoScrollRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    isAutoScrollRef.current = atBottom;
  }, []);

  useEffect(() => {
    if (!isAutoScrollRef.current) return;
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isLoading]);

  // Becoming visible again (e.g. reopening the mobile panel) must re-pin the
  // transcript to the latest message: `display: none` collapsed the scroll
  // box while hidden, silently resetting `scrollTop` to 0, and neither
  // `messages` nor `isLoading` necessarily changed in the meantime to
  // trigger the effect above. Mirrors the old unmount/remount behavior,
  // where a freshly mounted MessageList always started pinned to bottom.
  useEffect(() => {
    if (!isVisible) return;
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    isAutoScrollRef.current = true;
  }, [isVisible]);

  const lastMessage = messages[messages.length - 1];
  const showTrailingIndicator =
    isLoading && (!lastMessage || lastMessage.role === "user");

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto layers-scrollbar px-3 py-3 space-y-3"
    >
      {messages.length === 0 && (
        <PanelEmptyState icon={<SparkleIcon size={20} weight="light" />}>
          {t("chat.emptyState")}
        </PanelEmptyState>
      )}

      {messages.map((msg) => {
        const isUser = msg.role === "user";

        if (isUser) {
          const textContent = msg.parts
            .filter(
              (p): p is { type: "text"; text: string } => p.type === "text"
            )
            .map((p) => p.text)
            .join("");
          const shownText = textContent;

          const imageParts = msg.parts.filter(
            (p): p is { type: "file"; mediaType: string; url: string } => {
              if (p.type !== "file") return false;
              const fp = p as { mediaType?: string };
              return typeof fp.mediaType === "string" && fp.mediaType.startsWith("image/");
            }
          );

          return (
            <div key={msg.id} className="group flex justify-end items-center gap-1">
              <MessageCopyButton msg={msg} />
              {onRollback && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => onRollback(msg.id)}
                        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded-control-sm hover:bg-secondary text-text-muted transition-colors"
                        aria-label={t("chat.rollback")}
                      >
                        <ArrowCounterClockwiseIcon size={14} />
                      </button>
                    }
                  />
                  <TooltipContent>{t("chat.rollback")}</TooltipContent>
                </Tooltip>
              )}
              <div className="max-w-[85%] rounded-xl px-3 py-2 rounded-md bg-secondary text-secondary-foreground transition-colors">
                {imageParts.length > 0 && (
                  <div className="flex gap-2 flex-wrap mb-1">
                    {imageParts.map((p, i) => (
                      <ImagePreview
                        key={i}
                        url={p.url}
                        urls={imageParts.map((part) => part.url)}
                        index={i}
                      />
                    ))}
                  </div>
                )}
                {shownText && <SimpleMarkdown content={shownText} />}
              </div>
            </div>
          );
        }

        // Assistant: render parts inline in order
        const hasAnyContent = msg.parts.some(
          (p) => (p.type === "text" && p.text) || p.type === "reasoning" || isToolUIPart(p),
        );
        const isEmptyStreaming =
          isLoading &&
          msg === lastMessage &&
          !hasAnyContent;

        return (
          <div key={msg.id} className="group flex flex-col items-start gap-1">
            <div className="w-full rounded-xl px-3 py-2 text-text-primary">
              {msg.parts.map((part, i) => {
                if (part.type === "text" && part.text) {
                  return <SimpleMarkdown key={i} content={part.text} />;
                }
                if (part.type === "reasoning" && part.text) {
                  return <ThinkingIndicator key={`reasoning-${i}`} part={part} />;
                }
                if (part.type === "tool-ask_user") {
                  const tp = part as {
                    toolCallId: string;
                    state?: string;
                    input?: AskUserInput;
                  };
                  // Only own the render for a ready form (input-available) or its
                  // answered summary (output-available). While the tool input is
                  // still streaming (partial/absent) or the call errored, fall
                  // through to the generic ToolCallIndicator below.
                  if (
                    tp.input &&
                    (tp.state === "input-available" || tp.state === "output-available")
                  ) {
                    return (
                      <AskUserForm
                        key={tp.toolCallId}
                        input={tp.input}
                        state={tp.state === "output-available" ? "output" : "input"}
                        onSubmit={(output) =>
                          addToolOutput?.({ tool: "ask_user", toolCallId: tp.toolCallId, output })
                        }
                      />
                    );
                  }
                }
                if (part.type === "tool-schedule_create") {
                  const tp = part as { toolCallId: string; state?: string; input?: unknown; output?: unknown };
                  const input = parseScheduleCreateInput(tp.input);
                  // The pending card is drawn by the same rule that blocks the composer (isPendingScheduleCreatePart).
                  if (input && (isPendingScheduleCreatePart(part) || tp.state === "output-available")) {
                    return (
                      <ScheduleConfirmCard
                        key={tp.toolCallId}
                        input={input}
                        state={tp.state === "output-available" ? "output" : "input"}
                        output={tp.output}
                        onResolve={(output) =>
                          addToolOutput?.({ tool: "schedule_create", toolCallId: tp.toolCallId, output })
                        }
                      />
                    );
                  }
                }
                if (part.type.startsWith("tool-") && isScheduleActionTool(part.type.slice(5))) {
                  const tool = part.type.slice(5) as ScheduleActionTool;
                  const tp = part as { toolCallId: string; state?: string; input?: unknown; output?: unknown };
                  const call = parseScheduleActionInput(tool, tp.input);
                  // Pending: drawn only while the precheck's record exists (same rule that blocks the composer).
                  if (call && (isPendingScheduleActionPart(part) || tp.state === "output-available")) {
                    return (
                      <ScheduleActionCard
                        key={tp.toolCallId}
                        call={call}
                        state={tp.state === "output-available" ? "output" : "input"}
                        output={tp.output}
                        details={pendingScheduleActions.get(tp.toolCallId)}
                        onResolve={(output) => addToolOutput?.({ tool, toolCallId: tp.toolCallId, output })}
                      />
                    );
                  }
                }
                if (part.type === "tool-memory") {
                  const tp = part as { toolCallId: string; state?: string; errorText?: string; input?: unknown; output?: unknown };
                  // Server-executed and never throws: a failure is an ordinary output with { ok: false }. Only a real
                  // success gets the "Memory updated" row; anything else falls through to the generic indicator.
                  if (tp.state === "output-available" && !tp.errorText && isMemoryWriteSuccessful(tp.output)) {
                    return <MemoryActivityRow key={tp.toolCallId} changes={memoryChangesFromInput(tp.input)} />;
                  }
                }
                if (isToolUIPart(part)) {
                  const tp = part as { toolCallId: string };
                  if (part.type === "tool-browse_agent") {
                    return <BrowseAgentIndicator key={tp.toolCallId} part={part} />;
                  }
                  return (
                    <ToolCallIndicator key={tp.toolCallId} part={part} />
                  );
                }
                return null;
              })}
              {notesByMessage.get(msg.id)?.map((n) => (
                <MemoryActivityRow key={n.id} changes={noteChangeList(n.changesByEvent)} />
              ))}
              {isEmptyStreaming && <StreamingIndicator />}
            </div>
            <div className="ml-2 flex items-center">
              <MessageCopyButton msg={msg} />
            </div>
          </div>
        );
      })}

      {showTrailingIndicator && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-xl px-3 py-2 text-text-primary">
            <StreamingIndicator />
          </div>
        </div>
      )}
    </div>
  );
}
