import { BrainIcon, ClockIcon, GlobeIcon, PaletteIcon, PlugsIcon } from "@/components/icons";

import type { MessageKey } from "@/i18n";
import type { SettingsSection } from "@/lib/openSettings";

export const SETTINGS_NAV: { id: SettingsSection; labelKey: MessageKey; icon: typeof PaletteIcon }[] = [
  { id: "appearance", labelKey: "settings.nav.appearance", icon: PaletteIcon },
  { id: "model", labelKey: "settings.nav.model", icon: BrainIcon },
  { id: "browser", labelKey: "settings.nav.browser", icon: GlobeIcon },
  { id: "mcp", labelKey: "settings.nav.mcp", icon: PlugsIcon },
  { id: "schedules", labelKey: "settings.nav.schedules", icon: ClockIcon },
];
