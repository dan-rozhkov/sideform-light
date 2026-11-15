export const SETTINGS_SECTIONS = ["appearance", "browser", "mcp", "schedules"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];
export const DEFAULT_SETTINGS_SECTION: SettingsSection = "appearance";

/** An unknown or missing `section` query value falls back to the default. */
export function parseSettingsSection(value: string | null | undefined): SettingsSection {
  return SETTINGS_SECTIONS.find((s) => s === value) ?? DEFAULT_SETTINGS_SECTION;
}

/**
 * Opens the shell's Settings tab (agent panel first, then the tab preload). Does nothing outside the shell.
 */
export function openSettings(section?: SettingsSection): void {
  const bridge = window.penAgentPanel?.settings?.open ? window.penAgentPanel.settings : window.penDesktop?.settings;
  if (typeof bridge?.open !== "function") return;
  const warn = (reason: unknown) => console.warn("[openSettings] the shell could not open Settings", reason);
  try {
    void Promise.resolve(bridge.open(section)).then((result) => {
      if (result && result.ok === false) warn(result);
    }, warn);
  } catch (error) {
    warn(error);
  }
}
