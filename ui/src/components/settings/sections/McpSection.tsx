import { useCallback, useEffect, useRef, useState } from "react";

import { CheckIcon, CopyIcon, EyeIcon, EyeSlashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Switch } from "@/components/ui/switch";
import type { McpSettingsView } from "@/lib/desktopBridge";
import { claudeCodeSnippet, hermesSnippet } from "@/lib/mcpSnippets";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

const STATUS_POLL_STARTING_MS = 2000;
const STATUS_POLL_MS = 15_000;
const MASK = "••••••••••••••••";

function statusText(view: McpSettingsView): string {
  switch (view.status.state) {
    case "off":
      return "Off";
    case "starting":
      return "Starting…";
    case "listening":
      return `Listening on ${view.url}`;
    case "error":
      return view.status.error ? `Could not start: ${view.status.error}` : "Could not start";
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
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
    <IconButton type="button" variant="ghost" size="icon-sm" tooltip={copied ? "Copied" : label} aria-label={label} onClick={copy}>
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
    </IconButton>
  );
}

function Snippet({ title, text, shown }: { title: string; text: string; shown: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-text-primary">{title}</h4>
        <CopyButton text={text} label={`Copy ${title} snippet`} />
      </div>
      <pre className="overflow-x-auto rounded-control-lg bg-secondary px-3 py-2 text-xs/relaxed text-secondary-foreground">
        <code>{shown}</code>
      </pre>
    </div>
  );
}

function McpControls({ api }: { api: NonNullable<NonNullable<typeof window.penDesktop>["mcp"]> }) {
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
        aliveRef.current && !busyRef.current && setPollError(e instanceof Error ? e.message : "Could not read the MCP settings"),
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
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const enabled = view?.enabled ?? false;
  const token = view?.token ?? "";
  const url = view?.url ?? "";
  const shownToken = reveal ? token : MASK;

  return (
    <>
      <SettingsGroup
        inline
        title="Let other agents give tasks to Sideform"
        description="Agents on this computer, such as Hermes Agent or Claude Code, can start tasks and read the results. Off by default."
      >
        <Switch
          aria-label="Let other agents give tasks to Sideform"
          checked={enabled}
          disabled={view === null || busy}
          onCheckedChange={(next) => void run(() => api.set({ enabled: next }))}
        />
      </SettingsGroup>

      <SettingsGroup title="Status">
        <p role="status" data-testid="mcp-status" className="text-sm text-text-primary">
          {view ? statusText(view) : error ? "Unknown" : "Loading…"}
        </p>
        {error && (
          <p role="alert" className="text-xs text-red-500">
            {error}
          </p>
        )}
      </SettingsGroup>

      {view && (
        <>
          <SettingsGroup title="Address">
            <div className="flex items-center gap-1">
              <code data-testid="mcp-url" className="min-w-0 flex-1 truncate rounded-control-lg bg-secondary px-3 py-1.5 text-xs">
                {url}
              </code>
              <CopyButton text={url} label="Copy address" />
            </div>
          </SettingsGroup>

          <SettingsGroup title="Token" description="Clients send it with every request. Keep it private.">
            <div className="flex items-center gap-1">
              <code data-testid="mcp-token" className="min-w-0 flex-1 truncate rounded-control-lg bg-secondary px-3 py-1.5 text-xs">
                {shownToken}
              </code>
              <IconButton
                type="button"
                variant="ghost"
                size="icon-sm"
                tooltip={reveal ? "Hide token" : "Show token"}
                aria-label={reveal ? "Hide token" : "Show token"}
                aria-pressed={reveal}
                onClick={() => setReveal((r) => !r)}
              >
                {reveal ? <EyeSlashIcon aria-hidden /> : <EyeIcon aria-hidden />}
              </IconButton>
              <CopyButton text={token} label="Copy token" />
            </div>
            <div>
              <Button type="button" variant="outline" size="lg" disabled={busy} onClick={() => void run(() => api.regenerateToken())}>
                Regenerate token
              </Button>
              <p className="mt-1 text-xs text-text-muted">Clients using the old token stop working.</p>
            </div>
          </SettingsGroup>

          <SettingsGroup title="Connect a client" description="Tasks run with everything the Sideform agent can do, including saved logins.">
            <Snippet
              title="Hermes Agent (~/.hermes/config.yaml)"
              text={hermesSnippet(url, token)}
              shown={hermesSnippet(url, shownToken)}
            />
            <Snippet title="Claude Code" text={claudeCodeSnippet(url, token)} shown={claudeCodeSnippet(url, shownToken)} />
          </SettingsGroup>
        </>
      )}
    </>
  );
}

export function McpSection() {
  const api = typeof window !== "undefined" ? window.penDesktop?.mcp : undefined;
  return (
    <SettingsSection title="MCP">
      {api ? (
        <McpControls api={api} />
      ) : (
        <SettingsGroup title="Not available in this version" description="Update Sideform Light to let other agents give it tasks." />
      )}
    </SettingsSection>
  );
}
