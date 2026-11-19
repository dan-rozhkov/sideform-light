import { useCallback, useEffect, useRef, useState } from "react";

import { BookOpenIcon, TrashIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/IconButton";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import {
  clearAgentMemory,
  deleteMemoryEntry,
  fetchAgentMemory,
  memoryUsage,
  setAgentMemoryEnabled,
  type AgentMemory,
  type MemoryTarget,
} from "@/lib/agentMemoryApi";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; memory: AgentMemory };

/** Used space of one target, computed like the backend does (entries joined with "\n§\n"). */
function UsageGauge({ label, entries, limit }: { label: string; entries: string[]; limit: number }) {
  const t = useT();
  if (limit <= 0) return null;
  const used = memoryUsage(entries);
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={t("memory.usage.aria", { group: label })}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="h-1 overflow-hidden rounded-full bg-surface-elevated"
      >
        <div className={pct >= 90 ? "h-full bg-destructive" : "h-full bg-text-muted"} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-text-muted tabular-nums">{t("memory.usage", { used, limit })}</p>
    </div>
  );
}

function EntryList({
  title,
  target,
  entries,
  limit,
  disabled,
  onDelete,
}: {
  title: string;
  target: MemoryTarget;
  entries: string[];
  limit: number;
  disabled: boolean;
  onDelete: (target: MemoryTarget, index: number) => void;
}) {
  const t = useT();
  if (entries.length === 0) return null;
  return (
    <SettingsGroup title={title}>
      <ul className="list-none divide-y divide-border-default overflow-hidden rounded-control border border-border-default">
        {entries.map((text, index) => (
          // Duplicates are legal, so the index is part of the key.
          <li key={`${index}:${text}`} className="flex items-start justify-between gap-3 px-3 py-2">
            <span className="min-w-0 text-sm break-words whitespace-pre-wrap text-text-primary">{text}</span>
            <IconButton
              type="button"
              variant="ghost"
              size="icon"
              tooltip={t("common.delete")}
              aria-label={t("memory.delete.aria", { text: text.slice(0, 60) })}
              disabled={disabled}
              onClick={() => onDelete(target, index)}
              className="hover:text-destructive"
            >
              <TrashIcon className="size-4" weight="light" />
            </IconButton>
          </li>
        ))}
      </ul>
      <UsageGauge label={title} entries={entries} limit={limit} />
    </SettingsGroup>
  );
}

function MemoryBody() {
  const t = useT();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // One write at a time: while it is in flight every write control is disabled, so results never interleave.
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const busyRef = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void fetchAgentMemory().then((res) => {
      if (!live) return;
      setLoad(res.ok ? { status: "ready", memory: res.data } : { status: "error" });
    });
    return () => {
      live = false;
    };
  }, [tick]);

  const retry = useCallback(() => {
    setLoad({ status: "loading" });
    setTick((n) => n + 1);
  }, []);

  const patch = (fn: (m: AgentMemory) => AgentMemory) =>
    setLoad((cur) => (cur.status === "ready" ? { status: "ready", memory: fn(cur.memory) } : cur));

  async function write(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const toggle = (enabled: boolean, previous: boolean) =>
    write(async () => {
      patch((m) => ({ ...m, enabled }));
      const res = await setAgentMemoryEnabled(enabled);
      if (!alive.current) return;
      if (!res.ok) {
        patch((m) => ({ ...m, enabled: previous }));
        setActionError(t("memory.error.toggle"));
      }
    });

  const remove = (target: MemoryTarget, index: number) =>
    write(async () => {
      if (load.status !== "ready") return;
      const text = load.memory[target][index];
      if (text === undefined) return;
      patch((m) => ({ ...m, [target]: m[target].filter((_, i) => i !== index) }));
      const res = await deleteMemoryEntry(target, text);
      if (!alive.current) return;
      // 404: already gone on the backend, so the removal stands.
      if (!res.ok && res.status !== 404) {
        patch((m) => ({ ...m, [target]: [...m[target].slice(0, index), text, ...m[target].slice(index)] }));
        setActionError(t("memory.error.delete"));
      }
    });

  const clearAll = () =>
    write(async () => {
      const res = await clearAgentMemory();
      if (!alive.current) return;
      setConfirmClear(false);
      if (res.ok) patch((m) => ({ ...m, memory: [], user: [] }));
      else setActionError(t("memory.error.clear"));
    });

  if (load.status === "loading") {
    return (
      <p role="status" className="py-5 text-sm text-text-muted">
        {t("common.loading")}
      </p>
    );
  }
  if (load.status === "error") {
    return (
      <div role="alert" className="flex items-center justify-between gap-4 py-5">
        <p className="text-sm text-text-muted">{t("memory.loadError")}</p>
        <Button type="button" variant="outline" onClick={retry}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  const { memory } = load;
  if (!memory.available) {
    return (
      <div className="flex justify-center py-10">
        <EmptyState
          size="panel"
          icon={<BookOpenIcon />}
          title={t("memory.unavailable.title")}
          description={t("memory.unavailable.description")}
        />
      </div>
    );
  }
  const empty = memory.user.length === 0 && memory.memory.length === 0;
  return (
    <>
      <SettingsGroup inline title={t("memory.enabled.title")} description={t("memory.enabled.description")}>
        <Switch
          aria-label={t("memory.enabled.title")}
          checked={memory.enabled}
          disabled={busy}
          onCheckedChange={(next) => void toggle(next, memory.enabled)}
        />
      </SettingsGroup>
      {empty && (
        <div className="flex justify-center py-10">
          <EmptyState size="panel" icon={<BookOpenIcon />} title={t("memory.empty")} />
        </div>
      )}
      <EntryList
        title={t("memory.group.user")}
        target="user"
        entries={memory.user}
        limit={memory.limits.user}
        disabled={busy}
        onDelete={(tg, i) => void remove(tg, i)}
      />
      <EntryList
        title={t("memory.group.notes")}
        target="memory"
        entries={memory.memory}
        limit={memory.limits.memory}
        disabled={busy}
        onDelete={(tg, i) => void remove(tg, i)}
      />
      {!empty && (
        <SettingsGroup
          inline
          title={t("memory.clear.title")}
          description={confirmClear ? t("memory.clear.confirm") : t("memory.clear.description")}
        >
          {confirmClear ? (
            <div role="group" aria-label={t("memory.clear.group")} className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmClear(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void clearAll()}>
                {t("memory.clear.confirmButton")}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirmClear(true)}>
              {t("memory.clear.button")}
            </Button>
          )}
        </SettingsGroup>
      )}
      {actionError && (
        <p role="alert" className="py-3 text-xs text-destructive">
          {actionError}
        </p>
      )}
    </>
  );
}

export function MemorySection() {
  const t = useT();
  return (
    <SettingsSection title={t("memory.title")} description={t("memory.description")}>
      <MemoryBody />
    </SettingsSection>
  );
}
