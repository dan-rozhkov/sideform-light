import { createHarnessTransport } from "@sideform/agent-harness/transport";
import type { RetryState } from "@sideform/agent-harness/retry-fetch";
import { CREDENTIALS_MODE, isOffline, resolveApiUrl } from "@/lib/apiBase";
import { t } from "@/i18n";
import { getByokConfig, isByokModel, isHeaderSafe } from "@/lib/byokProvider";
import { getAgentPanelTraceTabsBridge } from "@/lib/agentPanel";
import { isDesktopBrowserAvailable } from "@/lib/tools/browser/bridge";
import { browseAssertAvailable, isolatedBrowseAvailable } from "@/lib/tools/browser/isolation";

// Shared by the main chat (hooks/useDesignChat.ts) and the nested browse
// sub-agent session (lib/tools/browser/browseAgent.ts) so both hit /api/chat
// with the same credentials policy and retrying fetch.

// Told to the backend on every request so it can gate the browse_* tools into the per-request tool set.
// Derived ONCE at module scope: the tool set this controls is part of the cached request prefix, and a
// value that changed request to request would invalidate prompt caching.
export const CLIENT_CAPABILITIES = {
  desktopBrowser: isDesktopBrowserAvailable(),
  browser: "desktop",
  // browse_agent can run in QA mode (`qa: true`): the backend then offers the `qa` param.
  browseQa: true,
  // Isolated runs are available (the shell's `browser.isolated`): the backend then tells the model to call
  // several scenarios in one step.
  browseIsolation: isolatedBrowseAvailable(),
  // The browser supports `assert`: the backend then offers `qa_assert` and browse_agent `checks`.
  browseAssert: browseAssertAvailable(),
  // The shell can list and read open browse-run trace tabs: the backend then offers trace_list / trace_read.
  traceTabs: getAgentPanelTraceTabsBridge() !== undefined,
  // The shell can list and create schedules: the backend then offers schedule_list / schedule_create.
  // Only when the bridge exists (the key is absent otherwise).
  ...(window.penAgentPanel?.schedules ? { schedules: true } : {}),
} as const;

// Exported for tests.
export function resolveChatApiUrl(): string {
  // VITE_AI_API_URL is the explicit full chat URL; honor it verbatim. Otherwise
  // derive /api/chat from the shared backend base resolver.
  const explicitApiUrl = import.meta.env.VITE_AI_API_URL as string | undefined;
  return explicitApiUrl ?? resolveApiUrl("/api/chat");
}

export interface ChatTransportOptions {
  /** Extra request body fields, resolved on every send. */
  body: () => object | Promise<object>;
  onRetryStateChange?: (state: RetryState | null) => void;
  /** Test seam: replaces the network fetch under the retrying wrapper. */
  fetchImpl?: typeof fetch;
}

export function createChatTransport({ body, onRetryStateChange, fetchImpl }: ChatTransportOptions) {
  return createHarnessTransport({
    api: resolveChatApiUrl(),
    // No accounts and no cookies.
    credentials: () => CREDENTIALS_MODE,
    isOffline,
    offlineMessage: t("chat.offline"),
    onRetryStateChange,
    fetchImpl,
    body,
    // Own provider: base URL + key as headers, only on a `byok/` turn (the main chat or the nested browse
    // chat when it runs on the parent's byok model), never in the body. A missing half is omitted so the
    // backend answers 400 byok_key_required. A value fetch() would reject is skipped too.
    extraHeaders: (requestBody) => {
      const model = requestBody?.model;
      if (typeof model !== "string" || !isByokModel(model)) return undefined;
      const { baseUrl, apiKey } = getByokConfig();
      const headers: Record<string, string> = {};
      if (isHeaderSafe(baseUrl)) headers["X-BYOK-Base-URL"] = baseUrl;
      if (isHeaderSafe(apiKey)) headers["X-BYOK-Key"] = apiKey;
      return Object.keys(headers).length > 0 ? headers : undefined;
    },
  });
}
