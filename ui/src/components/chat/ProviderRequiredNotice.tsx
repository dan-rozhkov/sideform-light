import { PlugsIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useT } from "@/i18n";
import { openSettings } from "@/lib/openSettings";

/**
 * Shown in the composer while no model can run: Light has no model of its own, so the agent works only after
 * the user adds a provider in Settings > Model. The composer's send controls are disabled meanwhile.
 */
export function ProviderRequiredNotice() {
  const t = useT();
  return (
    <div data-testid="provider-required" className="flex justify-center border-b border-border-default px-3 py-3">
      <EmptyState
        size="panel"
        icon={<PlugsIcon weight="light" />}
        title={t("chat.providerRequired.title")}
        description={t("chat.providerRequired.description")}
        action={
          <Button type="button" size="sm" variant="accent" onClick={() => openSettings("model")}>
            {t("chat.providerRequired.action")}
          </Button>
        }
      />
    </div>
  );
}
