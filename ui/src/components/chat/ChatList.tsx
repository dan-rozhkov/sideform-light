import { useMemo } from "react";
import { ClockIcon, PlusIcon, XIcon } from "@/components/icons";
import { useChatStore } from "@/store/chatStore";
import type { ChatSummary } from "@/store/chatStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/relativeTime";
import { PanelEmptyState } from "@/components/PanelEmptyState";
import { useT } from "@/i18n";
import { displayChatTitle } from "@/lib/chatTitle";

/** Chats needing an answer sort first, then most-recently-active first.
 * Copies the store's array rather than sorting it in place — the store's
 * `chats` reference is read by other selectors and must stay stable. */
function sortChats(chats: ChatSummary[]): ChatSummary[] {
  return [...chats].sort((a, b) => {
    if (a.needsAnswer !== b.needsAnswer) return a.needsAnswer ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

function ChatStatus({ chat }: { chat: ChatSummary }) {
  const t = useT();
  if (chat.needsAnswer) {
    return (
      <Badge variant="destructive" className="mt-0.5">
        {t("chat.needsAnswer")}
      </Badge>
    );
  }
  if (chat.isBusy) {
    return <span className="text-xs text-text-muted">{t("chat.working")}</span>;
  }
  if (chat.unread) {
    return <span className="text-xs text-text-muted">{t("chat.newReply")}</span>;
  }
  return (
    <span className="text-xs text-text-muted">{formatRelativeTime(chat.updatedAt)}</span>
  );
}

function ChatListRow({ chat }: { chat: ChatSummary }) {
  const t = useT();
  const openChat = useChatStore((s) => s.openChat);
  const closeChat = useChatStore((s) => s.closeChat);

  return (
    // A plain <div>, not a <button> — the row needs a delete control that is
    // its own focusable, clickable button, and a <button> nested inside a
    // <button> is invalid HTML: browsers ignore the nesting and screen
    // readers read the whole row (title + status + "Delete chat") as one
    // control, with undefined keyboard behavior for the inner element.
    <div className="group relative flex w-full items-center gap-2 rounded-lg hover:bg-secondary">
      <button
        type="button"
        data-testid={`chat-list-item-${chat.id}`}
        onClick={() => openChat(chat.id)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
      >
        {chat.unread && (
          <span
            data-testid={`chat-unread-${chat.id}`}
            className="size-1.5 shrink-0 rounded-full bg-accent-primary"
          >
            <span className="sr-only">{t("chat.unread")}</span>
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            {chat.source === "schedule" && (
              <ClockIcon
                size={12}
                role="img"
                aria-label={t("chat.scheduledRun")}
                data-testid={`chat-scheduled-${chat.id}`}
                className="shrink-0 text-text-muted"
              />
            )}
            <span className="truncate text-xs font-semibold text-text-primary">{displayChatTitle(chat)}</span>
          </span>
          <ChatStatus chat={chat} />
        </span>
      </button>
      <button
        type="button"
        data-testid={`delete-chat-${chat.id}`}
        aria-label={t("chat.deleteChat")}
        onClick={(e) => {
          e.stopPropagation();
          closeChat(chat.id);
        }}
        className="mr-2 flex size-6 shrink-0 items-center justify-center rounded-control-sm text-text-muted opacity-0 hover:bg-secondary group-hover:opacity-100 focus-visible:opacity-100"
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}

/** Landing view of the chat panel — shown while `activeChatId` is null. */
export function ChatList() {
  const t = useT();
  const chats = useChatStore((s) => s.chats);
  const createChat = useChatStore((s) => s.createChat);
  const sortedChats = useMemo(() => sortChats(chats), [chats]);

  return (
    <div data-testid="chat-list" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="p-2">
        <Button
          type="button"
          data-testid="chat-list-new"
          onClick={() => createChat()}
          variant="outline"
          className="w-full"
        >
          <PlusIcon weight="light" />
          {t("chat.newChat")}
        </Button>
      </div>
      {sortedChats.length === 0 ? (
        <PanelEmptyState icon={<PlusIcon size={20} weight="light" />}>
          {t("chat.noChats")}
        </PanelEmptyState>
      ) : (
        <div className="layers-scrollbar flex-1 overflow-y-auto px-2 pb-2">
          {sortedChats.map((chat) => (
            <ChatListRow key={chat.id} chat={chat} />
          ))}
        </div>
      )}
    </div>
  );
}
