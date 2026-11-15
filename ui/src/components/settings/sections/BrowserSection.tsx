import { useEffect, useState, useSyncExternalStore } from "react";

import { useT, type MessageKey } from "@/i18n";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTraceMode, setTraceMode, subscribeTraceMode, type TraceMode } from "@/lib/browseTracePref";
import { getDesktopBrowserSettings, hasDesktopBrowserSettings, setDesktopBrowserSettings } from "@/lib/desktopBrowserSettings";

import { SettingsGroup, SettingsSection } from "../SettingsSection";

function AdBlockRow() {
  const t = useT();
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
      title={t("settings.browser.adBlock.title")}
      description={t("settings.browser.adBlock.description")}
    >
      <Switch aria-label={t("settings.browser.adBlock.title")} checked={adBlock ?? false} disabled={adBlock === null} onCheckedChange={toggle} />
    </SettingsGroup>
  );
}

const TRACE_OPTIONS: { value: TraceMode; labelKey: MessageKey }[] = [
  { value: "qa", labelKey: "settings.browser.traces.qa" },
  { value: "mcp", labelKey: "settings.browser.traces.mcp" },
  { value: "all", labelKey: "settings.browser.traces.all" },
];

function TraceRow() {
  const t = useT();
  const mode = useSyncExternalStore(subscribeTraceMode, getTraceMode, () => "mcp" as TraceMode);
  return (
    <SettingsGroup
      inline
      title={t("settings.browser.traces.title")}
      description={t("settings.browser.traces.description")}
    >
      <Select value={mode} onValueChange={(v) => {
        const opt = TRACE_OPTIONS.find((o) => o.value === v);
        if (opt) setTraceMode(opt.value);
      }}>
        <SelectTrigger size="sm" aria-label={t("settings.browser.traces.title")}>
          <SelectValue>{t(TRACE_OPTIONS.find((o) => o.value === mode)?.labelKey ?? "settings.browser.traces.mcp")}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="end" className="w-auto">
          {TRACE_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {t(o.labelKey)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsGroup>
  );
}

export function BrowserSection() {
  const t = useT();
  return (
    <SettingsSection title={t("settings.nav.browser")}>
      <TraceRow />
      {hasDesktopBrowserSettings() && <AdBlockRow />}
    </SettingsSection>
  );
}
