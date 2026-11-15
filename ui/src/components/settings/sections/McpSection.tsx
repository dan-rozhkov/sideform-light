import { useCallback, useEffect, useRef, useState } from "react";

import { CheckIcon, CopyIcon, EyeIcon, EyeSlashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { IconSwap } from "@/components/ui/IconSwap";
import { Switch } from "@/components/ui/switch";
import { t, useT } from "@/i18n";
import type { McpSettingsView } from "@/lib/desktopBridge";
import { claudeCodeSnippet, hermesSnippet } from "@/lib/mcpSnippets";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

const STATUS_POLL_STARTING_MS = 2000;
const STATUS_POLL_MS = 15_000;
const MASK = "••••••••••••••••";

function statusText(view: McpSettingsView): string {
  switch (view.status.state) {
    case "off":
      return t("settings.mcp.status.off");
    case "starting":
      return t("settings.mcp.status.starting");
    case "listening":
      return t("settings.mcp.status.listening", { url: view.url });
    case "error":
      return view.status.error ? t("settings.mcp.status.error", { error: view.status.error }) : t("settings.mcp.status.errorBare");
  }
}

const STATUS_DOT: Record<McpSettingsView["status"]["state"], string> = {
  off: "bg-muted-foreground/60",
  starting: "bg-amber-500",
  listening: "bg-emerald-500",
  error: "bg-destructive",
};

function CopyButton({ text, label, size = "icon" }: { text: string; label: string; size?: "icon" | "icon-sm" }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <IconButton type="button" variant="ghost" size={size} tooltip={copied ? t("common.copied") : label} aria-label={label} onClick={copy}>
      <IconSwap active={copied} activeIcon={<CheckIcon size={16} aria-hidden />} inactiveIcon={<CopyIcon size={16} aria-hidden />} />
    </IconButton>
  );
}

function Snippet({ title, text, shown }: { title: string; text: string; shown: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-text-primary">{title}</h4>
        <CopyButton text={text} label={t("settings.mcp.snippet.copy", { title })} size="icon-sm" />
      </div>
      <pre className="overflow-x-auto rounded-control-lg bg-secondary px-3 py-2 text-xs/relaxed text-secondary-foreground">
        <code>{shown}</code>
      </pre>
    </div>
  );
}

function McpControls({ api }: { api: NonNullable<NonNullable<typeof window.penDesktop>["mcp"]> }) {
  const t = useT();
  const [view, setView] = useState<McpSettingsView | null>(null);
  // An error of a toggle / regenerate: only the next user action clears it. A poll never does.
  const [actionError, setError] = useState<string | null>(null);
  // An error of the background read: the next successful poll clears it.
  const [pollError, setPollError] = useState<string | null>(null);
  const error = actionError ?? pollError;
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);

  // Set while a toggle / regenerate call is in flight: a poll that lands meanwhile must not overwrite its result.
  const busyRef = useRef(false);

  const starting = view?.status.state === "starting";

  const aliveRef = useRef(true);
  const read = useCallback(() => {
    if (busyRef.current) return;
    api.get().then(
      (v) => {
        if (!aliveRef.current || busyRef.current) return;
        if ("error" in v) {
          setPollError(v.error);
          return;
        }
        setView(v);
        setPollError(null);
      },
      (e: unknown) =>
        aliveRef.current && !busyRef.current && setPollError(e instanceof Error ? e.message : t("settings.mcp.readError")),
    );
  }, [api]);

  useEffect(() => {
    aliveRef.current = true;
    read();
    return () => {
      aliveRef.current = false;
    };
  }, [read]);

  // The listener starts or fails after the switch is flipped (a busy port): re-read fast while "starting", slowly otherwise, only while visible.
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") read();
      },
      starting ? STATUS_POLL_STARTING_MS : STATUS_POLL_MS,
    );
    return () => clearInterval(timer);
  }, [read, starting]);

  const run = useCallback(
    async (call: () => Promise<McpSettingsView | { error: string }>) => {
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const out = await call();
        if ("error" in out) setError(out.error);
        else setView(out);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("settings.mcp.genericError"));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [t],
  );

  const enabled = view?.enabled ?? false;
  const token = view?.token ?? "";
  const url = view?.url ?? "";
  const shownToken = reveal ? token : MASK;

  return (
    <>
      <SettingsGroup
        inline
        title={t("settings.mcp.enable.title")}
        description={t("settings.mcp.enable.description")}
      >
        <Switch
          aria-label={t("settings.mcp.enable.title")}
          checked={enabled}
          disabled={view === null || busy}
          onCheckedChange={(next) => void run(() => api.set({ enabled: next }))}
        />
      </SettingsGroup>

      <SettingsGroup title={t("settings.mcp.status.title")}>
        <p
          role="status"
          data-testid="mcp-status"
          className="inline-flex h-7 max-w-full items-center gap-2 rounded-control bg-secondary px-3 text-xs text-text-primary"
        >
          <span aria-hidden className={`size-2 shrink-0 rounded-full ${view ? STATUS_DOT[view.status.state] : STATUS_DOT.off}`} />
          <span className="truncate">{view ? statusText(view) : error ? t("settings.mcp.status.unknown") : t("common.loading")}</span>
        </p>
        {error && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </SettingsGroup>

      {view && (
        <>
          <SettingsGroup title={t("settings.mcp.address.title")}>
            <div className="flex items-center gap-1">
              <code data-testid="mcp-url" className="block h-7 min-w-0 flex-1 truncate rounded-control bg-secondary px-3 text-xs leading-7">
                {url}
              </code>
              <CopyButton text={url} label={t("settings.mcp.address.copy")} />
            </div>
          </SettingsGroup>

          <SettingsGroup title={t("settings.mcp.token.title")} description={t("settings.mcp.token.description")}>
            <div className="flex items-center gap-1">
              <code data-testid="mcp-token" className="block h-7 min-w-0 flex-1 truncate rounded-control bg-secondary px-3 text-xs leading-7">
                {shownToken}
              </code>
              <IconButton
                type="button"
                variant="ghost"
                size="icon"
                tooltip={reveal ? t("settings.mcp.token.hide") : t("settings.mcp.token.show")}
                aria-label={reveal ? t("settings.mcp.token.hide") : t("settings.mcp.token.show")}
                aria-pressed={reveal}
                onClick={() => setReveal((r) => !r)}
              >
                <IconSwap active={reveal} activeIcon={<EyeSlashIcon size={16} aria-hidden />} inactiveIcon={<EyeIcon size={16} aria-hidden />} />
              </IconButton>
              <CopyButton text={token} label={t("settings.mcp.token.copy")} />
            </div>
            <div className="mt-3">
              <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => void run(() => api.regenerateToken())}>
                {t("settings.mcp.token.regenerate")}
              </Button>
            </div>
          </SettingsGroup>

          <SettingsGroup title={t("settings.mcp.connect.title")} description={t("settings.mcp.connect.description")}>
            <div className="flex flex-col gap-4">
              <Snippet
                title="Hermes Agent (~/.hermes/config.yaml)"
                text={hermesSnippet(url, token)}
                shown={hermesSnippet(url, shownToken)}
              />
              <Snippet title="Claude Code" text={claudeCodeSnippet(url, token)} shown={claudeCodeSnippet(url, shownToken)} />
            </div>
          </SettingsGroup>
        </>
      )}
    </>
  );
}

export function McpSection() {
  const t = useT();
  const api = typeof window !== "undefined" ? window.penDesktop?.mcp : undefined;
  return (
    <SettingsSection title={t("settings.nav.mcp")}>
      {api ? (
        <McpControls api={api} />
      ) : (
        <SettingsGroup title={t("settings.mcp.unavailable.title")} description={t("settings.mcp.unavailable.description")} />
      )}
    </SettingsSection>
  );
}
