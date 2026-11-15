import { useEffect, useState, useSyncExternalStore } from "react";

import { Switch } from "@/components/ui/switch";
import { traceFlag } from "@/lib/browseTracePref";
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

function TraceRow() {
  const traces = useSyncExternalStore(traceFlag.subscribe, traceFlag.get, () => false);
  return (
    <SettingsGroup
      inline
      title="Record traces for all runs"
      description="Save a step-by-step trace of every browser run, with screenshots of the visited pages. QA tests and tasks from MCP clients always keep one."
    >
      <Switch aria-label="Record traces for all runs" checked={traces} onCheckedChange={traceFlag.set} />
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
