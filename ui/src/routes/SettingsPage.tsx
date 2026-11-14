import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router";

import { EditorProviders } from "@/components/EditorProviders";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { AppearanceSection } from "@/components/settings/sections/AppearanceSection";
import { BrowserSection } from "@/components/settings/sections/BrowserSection";
import { useHtmlRouteClass } from "@/hooks/useHtmlRouteClass";
import { parseSettingsSection, type SettingsSection } from "@/lib/openSettings";

const SECTION_VIEWS: Record<SettingsSection, () => React.JSX.Element> = {
  appearance: AppearanceSection,
  browser: BrowserSection,
};

/**
 * "/settings?section=appearance|browser": two sections. Writes localStorage from its own document;
 * the other views follow through `storage` events and the theme BroadcastChannel.
 */
export default function SettingsPage() {
  useHtmlRouteClass("route-settings");
  const [params, setParams] = useSearchParams();
  const section = parseSettingsSection(params.get("section"));

  useEffect(() => {
    document.title = "Settings";
  }, []);

  const select = useCallback(
    (next: SettingsSection) =>
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          out.set("section", next);
          return out;
        },
        { replace: true },
      ),
    [setParams],
  );

  // The shell asks an already open Settings tab to switch section.
  useEffect(() => window.penDesktop?.settings?.onSection?.((id) => select(parseSettingsSection(id))), [select]);

  const View = SECTION_VIEWS[section];
  return (
    <EditorProviders>
      <div className="flex h-dvh flex-col overflow-hidden bg-surface-panel text-text-primary md:flex-row">
        <SettingsNav active={section} onSelect={select} />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-10 md:py-8">
            <View />
          </div>
        </main>
      </div>
    </EditorProviders>
  );
}
