import { useEffect, useState, useSyncExternalStore } from "react";

import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTraceMode, setTraceMode, subscribeTraceMode, type TraceMode } from "@/lib/browseTracePref";
import { getDesktopBrowserSettings, hasDesktopBrowserSettings, setDesktopBrowserSettings } from "@/lib/desktopBrowserSettings";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

function AdBlockRow() {
  // null until loaded: the switch stays disabled, so no wrong value flashes.
  const [adBlock, setAdBlock] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    getDesktopBrowserSettings().then(
      (v) => alive && setAdBlock(v.adBlock),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (next: boolean) => {
    setAdBlock(next);
    setDesktopBrowserSettings({ adBlock: next }).catch(() => setAdBlock(!next));
  };

  return (
    <SettingsGroup
      inline
      title="Block ads and trackers"
      description="Block ads and tracking requests in the built-in browser. Pages load faster and the agent reads less noise."
    >
      <Switch aria-label="Block ads and trackers" checked={adBlock ?? false} disabled={adBlock === null} onCheckedChange={toggle} />
    </SettingsGroup>
  );
}

const TRACE_OPTIONS: { value: TraceMode; label: string }[] = [
  { value: "qa", label: "QA tests only" },
  { value: "mcp", label: "QA tests and MCP tasks" },
  { value: "all", label: "All runs" },
];

function TraceRow() {
  const mode = useSyncExternalStore(subscribeTraceMode, getTraceMode, () => "mcp" as TraceMode);
  return (
    <SettingsGroup
      inline
      title="Record traces"
      description="Save a step-by-step trace of a browser run, with screenshots of the visited pages and its network log. QA tests always keep one."
    >
      <Select value={mode} onValueChange={(v) => {
        const opt = TRACE_OPTIONS.find((o) => o.value === v);
        if (opt) setTraceMode(opt.value);
      }}>
        <SelectTrigger size="sm" aria-label="Record traces">
          <SelectValue>{TRACE_OPTIONS.find((o) => o.value === mode)?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="end" className="w-auto">
          {TRACE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsGroup>
  );
}

export function BrowserSection() {
  return (
    <SettingsSection title="Browser">
      <TraceRow />
      {hasDesktopBrowserSettings() && <AdBlockRow />}
    </SettingsSection>
  );
}
