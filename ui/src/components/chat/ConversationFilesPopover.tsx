import { useState } from "react";
import type { UIMessage } from "ai";
import { FilmStripIcon, ListBulletsIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { collectChatArtifacts, openChatArtifact, type ChatArtifact } from "@/lib/chatArtifacts";
import { traceOpener } from "@/lib/traceOpener";

const SECTION_LIMIT = 5;

/** Header button + popover listing the browse-run traces a chat touched. */
export function ConversationFilesPopover({ getMessages }: { getMessages: () => UIMessage[] }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ChatArtifact[]>([]);
  const [expanded, setExpanded] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    setExpanded(false);
    try {
      setItems(collectChatArtifacts(getMessages()).filter((a) => traceOpener({ id: a.traceId, source: "local" }) !== undefined));
    } catch {
      setItems([]);
    }
  };

  const shown = expanded ? items : items.slice(0, SECTION_LIMIT);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <IconButton
            data-testid="conversation-files-trigger"
            variant="ghost"
            size="icon"
            tooltip="Conversation files"
            aria-label="Conversation files"
          >
            <ListBulletsIcon className="size-4" weight="light" />
          </IconButton>
        }
      />
      <PopoverContent side="bottom" align="end" sideOffset={4} className="w-72 gap-3 rounded-xl p-3" data-testid="conversation-files-popover">
        {items.length === 0 ? (
          <p className="px-1 py-1 text-[13px] text-text-muted">Traces from this chat appear here.</p>
        ) : (
          <section className="flex flex-col gap-0.5">
            <h3 className="px-2 pb-1 text-[13px] text-text-muted">Traces</h3>
            {shown.map((a) => (
              <button
                key={a.traceId}
                type="button"
                onClick={() => {
                  openChatArtifact(a);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-primary outline-none hover:bg-secondary focus-visible:ring-[2px] focus-visible:ring-ring"
              >
                <FilmStripIcon size={15} className="shrink-0 text-text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{a.title}</span>
              </button>
            ))}
            {!expanded && items.length > SECTION_LIMIT && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-text-muted outline-none hover:bg-secondary focus-visible:ring-[2px] focus-visible:ring-ring"
              >
                Show all ({items.length})
              </button>
            )}
          </section>
        )}
      </PopoverContent>
    </Popover>
  );
}
