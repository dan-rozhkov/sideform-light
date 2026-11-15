import { RadioGroup } from "@base-ui/react/radio-group";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGES, useLanguage, useLanguageStore, useT } from "@/i18n";
import { useUIThemeStore } from "@/store/uiThemeStore";
import type { UITheme } from "@/lib/uiTheme";

import { SettingsGroup, SettingsSection } from "../SettingsSection";
import { ThemePreviewCard } from "../ThemePreviewCard";

function LanguageRow() {
  const t = useT();
  const language = useLanguage();
  return (
    <SettingsGroup inline title={t("settings.language.title")} description={t("settings.language.description")}>
      <Select
        value={language}
        onValueChange={(next) => {
          const option = LANGUAGES.find((l) => l.code === next);
          if (option) useLanguageStore.getState().setLanguage(option.code, { source: "user" });
        }}
      >
        <SelectTrigger size="sm" aria-label={t("settings.language.title")}>
          <SelectValue>{LANGUAGES.find((l) => l.code === language)?.nativeName}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="end" className="w-auto">
          {LANGUAGES.map((l) => (
            <SelectItem key={l.code} value={l.code} lang={l.code}>
              {l.nativeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsGroup>
  );
}

export function AppearanceSection() {
  const t = useT();
  const uiTheme = useUIThemeStore((s) => s.uiTheme);
  return (
    <SettingsSection title={t("settings.nav.appearance")}>
      <SettingsGroup title={t("settings.appearance.theme")} description={t("settings.appearance.themeDescription")}>
        <RadioGroup
          aria-label={t("settings.appearance.theme")}
          value={uiTheme}
          onValueChange={(next) => useUIThemeStore.getState().setUITheme(next as UITheme, { source: "user" })}
          className="grid grid-cols-2 gap-4"
        >
          <ThemePreviewCard theme="light" label={t("settings.appearance.light")} />
          <ThemePreviewCard theme="dark" label={t("settings.appearance.dark")} />
        </RadioGroup>
      </SettingsGroup>
      <LanguageRow />
    </SettingsSection>
  );
}
