import { ClockIcon, GlobeIcon, PaletteIcon, PlugsIcon } from "@/components/icons";

import type { SettingsSection } from "@/lib/openSettings";

export const SETTINGS_NAV: { id: SettingsSection; label: string; icon: typeof PaletteIcon }[] = [
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "browser", label: "Browser", icon: GlobeIcon },
  { id: "mcp", label: "MCP", icon: PlugsIcon },
  { id: "schedules", label: "Schedules", icon: ClockIcon },
];
