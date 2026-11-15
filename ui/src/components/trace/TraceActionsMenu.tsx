import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { DotsThreeVerticalIcon, DownloadSimpleIcon, FileCodeIcon } from "@/components/icons";
import { memo } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/IconButton";
import { useT } from "@/i18n";
import { useDownloadTrace, usePlaywrightSpec } from "./useTraceActions";

/** The one-off actions of the trace header in one overflow menu (like the /workflow and /doc options menus). Progress and failures are toasts. */
export const TraceActionsMenu = memo(function TraceActionsMenu({ trace }: { trace: BrowseTrace }) {
  const t = useT();
  const { busy, download } = useDownloadTrace(trace);
  const playwright = usePlaywrightSpec(trace);
  return (
    <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton variant="ghost" size="icon" tooltip={t("trace.actions.options")}>
              <DotsThreeVerticalIcon className="size-4" weight="light" />
            </IconButton>
          }
        />
        <DropdownMenuContent align="end" sideOffset={4} className="w-auto min-w-48 whitespace-nowrap">
          <DropdownMenuItem disabled={busy} onClick={() => void download()}>
            <DownloadSimpleIcon weight="light" /> {t("trace.actions.download")}
          </DropdownMenuItem>
          {playwright.available && (
            <DropdownMenuItem onClick={playwright.download}>
              <FileCodeIcon weight="light" /> {t("trace.actions.downloadPlaywright")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
    </DropdownMenu>
  );
});
