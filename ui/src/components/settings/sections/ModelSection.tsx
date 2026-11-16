import { useT } from "@/i18n";

import { SettingsSection } from "../SettingsSection";
import { CustomProviderGroup } from "./CustomProviderGroup";

/** The agent's model: the user's own OpenAI-compatible provider is the ONLY provider; the agent does not run without one. */
export function ModelSection() {
  const t = useT();
  return (
    <SettingsSection title={t("settings.nav.model")} description={t("settings.model.intro")}>
      <CustomProviderGroup />
    </SettingsSection>
  );
}
