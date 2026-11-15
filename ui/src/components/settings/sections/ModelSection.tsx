import { useT } from "@/i18n";

import { SettingsSection } from "../SettingsSection";
import { CustomProviderGroup } from "./CustomProviderGroup";

/** The agent's model: today only the user's own OpenAI-compatible provider (the hosted models are picked in the chat). */
export function ModelSection() {
  const t = useT();
  return (
    <SettingsSection title={t("settings.nav.model")} description={t("settings.model.intro")}>
      <CustomProviderGroup />
    </SettingsSection>
  );
}
